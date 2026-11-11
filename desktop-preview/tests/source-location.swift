import Foundation
import AppKit

private final class SourceNode {
    var attrs: [String: String]
    weak var parent: SourceNode?
    var children: [SourceNode] = []
    init(_ attrs: [String: String], _ children: [SourceNode] = []) {
        self.attrs = attrs; self.children = children
        for child in children { child.parent = self }
    }
}

@main private struct SourceLocationTests {
    @MainActor static func main() {
        func resolve(_ window: SourceNode, _ focused: SourceNode? = nil, browser: Bool = true) -> String? {
            SourceLocation.resolve(window: window, focused: focused, browser: browser, string: { $0.attrs[$1] }, parent: { $0.parent }, children: { $0.children })
        }
        let actual = "https://example.org/article?id=73#chapter"
        let linked = SourceNode(["AXRole": "AXLink", "AXURL": "https://unrelated.example/"])
        let page = SourceNode(["AXRole": "AXWebArea", "AXURL": actual], [linked])
        let window = SourceNode(["AXRole": "AXWindow"], [page])
        assert(resolve(window, linked) == actual, "selected links must not replace page provenance")
        assert(resolve(SourceNode(["AXDocument": actual])) == actual, "window document preserves query/fragment")
        assert(resolve(window) == actual, "image selection can find page without focused text")
        let address = SourceNode(["AXRole": "AXTextField", "AXDescription": "地址和搜索栏", "AXValue": "example.org/article"])
        assert(resolve(SourceNode([:], [address])) == "https://example.org/article", "localized address fallback")
        assert(resolve(SourceNode([:], [address]), browser: false) == nil, "no address guessing in other apps")
        let search = SourceNode(["AXRole": "AXTextField", "AXDescription": "Search", "AXValue": "https://unrelated.example/"])
        assert(resolve(SourceNode([:], [search])) == nil, "page search is not an address bar")
        assert(resolve(SourceNode(["AXDocument": "file:///tmp/example.txt"]), browser: false) == "file:///tmp/example.txt")
        assert(SourceLocation.validURL("javascript:alert(1)") == nil)
        assert(SourceLocation.validURL("https://user:secret@example.org") == nil)
        assert(SourceLocation.validURL("some selected text") == nil)
        assert(SourceLocation.validURL("chrome://extensions/") == nil)
        let embedded = SourceNode(["AXRole": "AXWebArea", "AXURL": actual])
        assert(resolve(SourceNode([:], [SourceNode(["AXRole": "AXWebArea"], [embedded])])) == nil, "missing page URL must not fall through to iframe URL")
        print("Source location: 12 checks passed")
        let icons = SourceApplicationIcons()
        let decorated = icons.decorate(["source": ["bundleId": "com.apple.finder", "appName": "访达"]])
        let source = decorated["source"] as! [String: Any]
        assert(source["appName"] as? String == "访达")
        let encoded = (source["appIcon"] as! String).replacingOccurrences(of: "data:image/png;base64,", with: "")
        let bitmap = NSBitmapImageRep(data: Data(base64Encoded: encoded)!)!
        assert(bitmap.pixelsWide == 32 && bitmap.pixelsHigh == 32)
        let unknown = icons.decorate(["source": ["url": "https://example.org/image"]])["source"] as! [String: Any]
        assert(unknown["appIcon"] == nil && unknown["appName"] == nil, "old URLs must not inherit the default browser")
        print("Application artwork: real 32px icon, recorded name and unknown-source checks passed")
    }
}
