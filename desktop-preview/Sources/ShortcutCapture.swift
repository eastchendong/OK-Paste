import AppKit
import ApplicationServices

struct ShortcutCaptureError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
    init(_ message: String) { self.message = message }
}

/// One explicit hotkey gesture, never a background clipboard watcher.
@MainActor final class ShortcutCapture {
    struct Environment {
        var trusted: () -> Bool
        var foregroundPID: () -> pid_t?
        var modifiersPressed: () -> Bool
        var changeCount: () -> Int
        var copy: (pid_t) throws -> Void
        var read: ([String: Any]) throws -> [String: Any]
        var pause: () async throws -> Void
    }
    private let environment: Environment
    private var busy = false

    init(environment: Environment? = nil) {
        self.environment = environment ?? Environment(
            trusted: { AXIsProcessTrusted() },
            foregroundPID: { NSWorkspace.shared.frontmostApplication?.processIdentifier },
            modifiersPressed: { !NSEvent.modifierFlags.intersection([.command, .option, .control, .shift]).isEmpty },
            changeCount: { NSPasteboard.general.changeCount },
            copy: { pid in
                let application = AXUIElementCreateApplication(pid)
                AXUIElementSetMessagingTimeout(application, 0.2)
                var value: CFTypeRef?
                if AXUIElementCopyAttributeValue(application, kAXFocusedUIElementAttribute as CFString, &value) == .success,
                   let value, CFGetTypeID(value) == AXUIElementGetTypeID() {
                    let focused = value as! AXUIElement
                    for attribute in [kAXRoleAttribute, kAXSubroleAttribute] {
                        var role: CFTypeRef?
                        AXUIElementCopyAttributeValue(focused, attribute as CFString, &role)
                        if role as? String == "AXSecureTextField" { throw ShortcutCaptureError("密码输入框不能加入内容包。") }
                    }
                }
                let source = CGEventSource(stateID: .privateState)
                guard let down = CGEvent(keyboardEventSource: source, virtualKey: 8, keyDown: true),
                      let up = CGEvent(keyboardEventSource: source, virtualKey: 8, keyDown: false) else {
                    throw ShortcutCaptureError("无法复制当前内容，请重试。")
                }
                down.flags = .maskCommand; up.flags = .maskCommand
                down.postToPid(pid); up.postToPid(pid)
            },
            read: { try Self.draft(from: .general, source: $0) },
            pause: { try await Task.sleep(nanoseconds: 50_000_000) }
        )
    }

    func capture(pid: pid_t, source: [String: Any]) async throws -> [String: Any] {
        guard !busy else { throw ShortcutCaptureError("正在加入内容包，请稍候。") }
        busy = true; defer { busy = false }
        guard environment.trusted() else { throw ShortcutCaptureError("请先在系统辅助功能中开启妥帖，再使用加入内容快捷键。") }
        func checkFocus() throws {
            guard environment.foregroundPID() == pid else { throw ShortcutCaptureError("当前应用已切换，请重新选择内容后按快捷键。") }
        }
        // Wait for the physical Option key to lift, so the target receives ⌘C.
        for _ in 0..<40 {
            try checkFocus()
            if !environment.modifiersPressed() { break }
            try await environment.pause()
        }
        guard !environment.modifiersPressed() else { throw ShortcutCaptureError("请松开快捷键后重试。") }
        try checkFocus()
        let before = environment.changeCount()
        try environment.copy(pid)
        for _ in 0..<50 {
            try await environment.pause()
            try checkFocus()
            if environment.changeCount() != before {
                let copied = environment.changeCount()
                let draft = try environment.read(source)
                guard copied == environment.changeCount() else { throw ShortcutCaptureError("剪贴板发生变化，请重新选择内容后重试。") }
                return draft
            }
        }
        throw ShortcutCaptureError("当前内容没有复制成功。请先选中文字；图片需先在原应用中选中或打开后再试。")
    }

    static func draft(from board: NSPasteboard, source: [String: Any]) throws -> [String: Any] {
        let maxBytes = 6_000_000
        func image(_ data: Data, _ mime: String) throws -> [String: Any] {
            guard !data.isEmpty, NSBitmapImageRep(data: data) != nil else { throw ShortcutCaptureError("复制到的图片无法读取。") }
            guard data.count <= maxBytes else { throw ShortcutCaptureError("图片超过 6 MB，请缩小后重试。") }
            return ["type": "image", "source": source, "body": ["mime": mime, "dataUrl": "data:\(mime);base64,\(data.base64EncodedString())"]]
        }
        // A copied file can include a thumbnail; use the actual image first.
        if let raw = board.string(forType: .fileURL), let url = URL(string: raw), url.isFileURL {
            let supported = ["png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"]
            guard let mime = supported[url.pathExtension.lowercased()] else { throw ShortcutCaptureError("当前快捷键支持文字和图片，这个文件类型暂不支持。") }
            let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
            guard values.isRegularFile == true, let size = values.fileSize, size <= maxBytes else { throw ShortcutCaptureError("图片超过 6 MB 或无法读取，请换一张图片。") }
            return try image(Data(contentsOf: url, options: .mappedIfSafe), mime)
        }
        if let png = board.data(forType: .png) { return try image(png, "image/png") }
        if let tiff = board.data(forType: .tiff) {
            guard tiff.count <= 32_000_000, let bitmap = NSBitmapImageRep(data: tiff),
                  let png = bitmap.representation(using: .png, properties: [:]) else { throw ShortcutCaptureError("复制到的图片无法读取或过大。") }
            return try image(png, "image/png")
        }
        var text = board.string(forType: .string)
        if text == nil, let rtf = board.data(forType: .rtf), rtf.count <= 2_000_000 {
            text = try? NSAttributedString(data: rtf, options: [.documentType: NSAttributedString.DocumentType.rtf], documentAttributes: nil).string
        }
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw ShortcutCaptureError("当前应用没有提供可读取的文字或图片。")
        }
        guard text.count <= 100_000 else { throw ShortcutCaptureError("文字超过 10 万字，请分段加入内容包。") }
        return ["type": "text", "source": source, "body": ["text": text]]
    }
}
