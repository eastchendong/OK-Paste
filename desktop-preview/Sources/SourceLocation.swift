import AppKit
import ApplicationServices

// Resolve installed application artwork by recorded identity, never by the
// current/default browser: that would misattribute older captures.
@MainActor final class SourceApplicationIcons {
    private var cache: [String: [String: String]] = [:]

    func decorate(_ item: [String: Any]) -> [String: Any] {
        guard var source = item["source"] as? [String: Any],
              let bundleID = source["bundleId"] as? String, !bundleID.isEmpty else { return item }
        if cache[bundleID] == nil {
            var info: [String: String] = [:]
            if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) {
                info["appName"] = FileManager.default.displayName(atPath: url.path).replacingOccurrences(of: ".app", with: "")
                let image = NSWorkspace.shared.icon(forFile: url.path)
                if let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 32, pixelsHigh: 32,
                    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
                   let context = NSGraphicsContext(bitmapImageRep: bitmap) {
                    NSGraphicsContext.saveGraphicsState()
                    NSGraphicsContext.current = context
                    image.draw(in: NSRect(x: 0, y: 0, width: 32, height: 32))
                    NSGraphicsContext.restoreGraphicsState()
                    if let png = bitmap.representation(using: .png, properties: [:]) {
                        info["appIcon"] = "data:image/png;base64," + png.base64EncodedString()
                    }
                }
            }
            cache[bundleID] = info
        }
        if (source["appName"] as? String)?.isEmpty != false { source["appName"] = cache[bundleID]?["appName"] }
        source["appIcon"] = cache[bundleID]?["appIcon"]
        var decorated = item; decorated["source"] = source
        return decorated
    }
}

enum SourceLocation {
    static func validURL(_ raw: String?, addressField: Bool = false) -> String? {
        guard let raw else { return nil }
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 4000, !text.contains(where: { $0.isWhitespace }) else { return nil }
        if addressField, !text.contains("://"), !text.hasPrefix("file:"),
           text.split(separator: "/").first?.contains(".") == true { text = "https://" + text }
        guard let url = URL(string: text), let scheme = url.scheme?.lowercased(), ["http", "https", "file"].contains(scheme) else { return nil }
        if scheme != "file", url.host?.isEmpty != false { return nil }
        guard url.user == nil, url.password == nil else { return nil }
        return url.absoluteString
    }

    /// Prefer document/page metadata. Never use AXURL on a selected hyperlink,
    /// or clipboard text that happens to contain a URL, as the source page.
    static func resolve<Node>(window: Node, focused: Node?, browser: Bool,
                              string: (Node, String) -> String?, parent: (Node) -> Node?,
                              children: (Node) -> [Node]) -> String? {
        if let url = validURL(string(window, "AXDocument")) { return url }
        var ancestor = focused
        for _ in 0..<10 {
            guard let node = ancestor else { break }
            if string(node, "AXRole") == "AXWebArea", let url = validURL(string(node, "AXURL")) { return url }
            ancestor = parent(node)
        }
        guard browser else { return nil }
        var pending: [(Node, Int)] = [(window, 0)], index = 0
        var address: String?
        while index < pending.count && index < 160 {
            let (node, depth) = pending[index]; index += 1
            let role = string(node, "AXRole") ?? ""
            if role == "AXWebArea" {
                if let url = validURL(string(node, "AXURL")) ?? validURL(string(node, "AXDocument")) { return url }
                // No need to walk the page's article, links, forms or iframes.
                continue
            }
            if ["AXTextField", "AXComboBox"].contains(role) {
                let label = ["AXIdentifier", "AXDescription", "AXTitle"].compactMap { string(node, $0) }.joined(separator: " ").lowercased()
                let names = ["address and search", "address field", "address bar", "地址和搜索", "地址栏", "網址", "smart search", "智能搜索", "web_browser_address_and_search_field"]
                if names.contains(where: { label.contains($0) }) { address = validURL(string(node, "AXValue"), addressField: true) }
            }
            if depth < 7 { pending.append(contentsOf: children(node).prefix(40).map { ($0, depth + 1) }) }
        }
        return address
    }

    static func read(from app: NSRunningApplication) -> String? {
        guard AXIsProcessTrusted() else { return nil }
        let application = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(application, 0.15)
        let deadline = Date().addingTimeInterval(0.8)
        func value(_ node: AXUIElement, _ name: String) -> CFTypeRef? {
            guard Date() < deadline else { return nil }
            var result: CFTypeRef?
            return AXUIElementCopyAttributeValue(node, name as CFString, &result) == .success ? result : nil
        }
        func element(_ node: AXUIElement, _ name: String) -> AXUIElement? {
            guard let result = value(node, name), CFGetTypeID(result) == AXUIElementGetTypeID() else { return nil }
            return (result as! AXUIElement)
        }
        let bundle = app.bundleIdentifier ?? ""
        let browsers = ["com.google.Chrome", "com.microsoft.edgemac", "com.apple.Safari", "company.thebrowser.Browser", "com.brave.Browser", "org.mozilla.firefox", "com.vivaldi.Vivaldi"]
        let browser = browsers.contains { bundle == $0 || bundle.hasPrefix($0 + ".") }
        if browser { AXUIElementSetAttributeValue(application, "AXManualAccessibility" as CFString, kCFBooleanTrue) }
        guard let window = element(application, "AXFocusedWindow") else { return nil }
        return resolve(window: window, focused: element(application, "AXFocusedUIElement"), browser: browser,
                       string: { node, name in
                           let result = value(node, name)
                           if let url = result as? URL { return url.absoluteString }
                           return result as? String
                       }, parent: { element($0, "AXParent") }, children: { value($0, "AXChildren") as? [AXUIElement] ?? [] })
    }
}
