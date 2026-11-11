import AppKit

@MainActor private final class CaptureFixture {
    let board = NSPasteboard(name: .init("cn.tuotie.capture-tests.\(UUID().uuidString)"))
    var pid: pid_t? = 77
    var trusted = true
    var held = false
    var copies = 0
    var reads = 0
    var ticks = 0
    var copyText: String?
    var afterPause: (() -> Void)?
    var duringRead: (() -> Void)?
    var environment: ShortcutCapture.Environment {
        .init(trusted: { self.trusted }, foregroundPID: { self.pid }, modifiersPressed: { self.held },
              changeCount: { self.board.changeCount }, copy: { _ in
                  self.copies += 1
                  if let text = self.copyText { self.board.clearContents(); self.board.setString(text, forType: .string) }
              }, read: { source in
                  self.reads += 1
                  let result = try ShortcutCapture.draft(from: self.board, source: source)
                  self.duringRead?()
                  return result
              }, pause: { self.ticks += 1; self.afterPause?(); await Task.yield() })
    }
    deinit { board.releaseGlobally() }
}

@main private struct CaptureTests {
    @MainActor static func main() async throws {
        var passed = 0
        func check(_ value: Bool, _ message: String) throws {
            guard value else { throw ShortcutCaptureError("FAILED: \(message)") }
        }
        func rejects(_ message: String, _ operation: () async throws -> Void) async throws {
            do { try await operation() } catch {
                try check(error.localizedDescription.contains(message), error.localizedDescription)
                passed += 1; return
            }
            throw ShortcutCaptureError("FAILED: expected rejection \(message)")
        }
        let source: [String: Any] = ["appName": "测试 App", "captureMethod": "global-shortcut"]
        let text = CaptureFixture(); text.copyText = "跨应用选中的中文 📎"
        let draft = try await ShortcutCapture(environment: text.environment).capture(pid: 77, source: source)
        try check((draft["body"] as? [String: Any])?["text"] as? String == text.copyText, "fresh text")
        try check((draft["source"] as? [String: Any])?["appName"] as? String == "测试 App", "source snapshot")
        passed += 1

        let stale = CaptureFixture(); stale.board.setString("旧剪贴板不可采集", forType: .string)
        try await rejects("没有复制成功") { _ = try await ShortcutCapture(environment: stale.environment).capture(pid: 77, source: source) }
        try check(stale.reads == 0, "must never read stale clipboard")

        let denied = CaptureFixture(); denied.trusted = false
        try await rejects("辅助功能") { _ = try await ShortcutCapture(environment: denied.environment).capture(pid: 77, source: source) }
        try check(denied.copies == 0, "must not copy without permission")

        let switched = CaptureFixture(); switched.copyText = "复制完成但已经切走"
        switched.afterPause = { switched.pid = 88 }
        try await rejects("应用已切换") { _ = try await ShortcutCapture(environment: switched.environment).capture(pid: 77, source: source) }
        try check(switched.reads == 0, "must not ingest after focus switch")

        let held = CaptureFixture(); held.held = true; held.copyText = "松开 Option 后复制"
        held.afterPause = { if held.ticks == 3 { held.held = false } }
        _ = try await ShortcutCapture(environment: held.environment).capture(pid: 77, source: source)
        try check(held.copies == 1 && held.ticks >= 4, "waits for modifier release")
        passed += 1

        let racing = CaptureFixture(); racing.copyText = "本次内容"
        racing.duringRead = { racing.board.clearContents(); racing.board.setString("并发替换", forType: .string) }
        try await rejects("剪贴板发生变化") { _ = try await ShortcutCapture(environment: racing.environment).capture(pid: 77, source: source) }

        let image = CaptureFixture()
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 2, pixelsHigh: 2, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        for x in 0..<2 { for y in 0..<2 { bitmap.setColor(NSColor(deviceRed: 0.1, green: 0.4, blue: 0.8, alpha: 1), atX: x, y: y) } }
        let png = bitmap.representation(using: .png, properties: [:])!
        image.board.setData(png, forType: .png); image.board.setString("图片的备用说明", forType: .string)
        let photo = try ShortcutCapture.draft(from: image.board, source: source)
        try check(photo["type"] as? String == "image", "image wins over fallback text")
        try check((photo["body"] as? [String: Any])?["dataUrl"] as? String == "data:image/png;base64,\(png.base64EncodedString())", "exact image bytes")
        passed += 1
        image.board.clearContents(); image.board.setData(bitmap.tiffRepresentation!, forType: .tiff)
        let tiff = try ShortcutCapture.draft(from: image.board, source: source)
        try check((tiff["body"] as? [String: Any])?["mime"] as? String == "image/png", "TIFF converted for preview")
        passed += 1

        let files = FileManager.default.temporaryDirectory.appendingPathComponent("tuotie-capture-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: files, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: files) }
        let file = files.appendingPathComponent("reference.png"); try png.write(to: file)
        image.board.clearContents(); image.board.setString(file.absoluteString, forType: .fileURL)
        image.board.setString(file.path, forType: .string)
        let copiedFile = try ShortcutCapture.draft(from: image.board, source: source)
        try check(copiedFile["type"] as? String == "image", "image file wins over path string")
        passed += 1
        image.board.clearContents(); image.board.setData(png + Data(repeating: 0, count: 6_000_001), forType: .png)
        try await rejects("6 MB") { _ = try ShortcutCapture.draft(from: image.board, source: source) }
        image.board.clearContents(); image.board.setString(files.appendingPathComponent("unsupported.pdf").absoluteString, forType: .fileURL)
        image.board.setString("unsupported.pdf", forType: .string)
        try await rejects("文件类型暂不支持") { _ = try ShortcutCapture.draft(from: image.board, source: source) }

        let empty = CaptureFixture()
        try await rejects("没有提供可读取") { _ = try ShortcutCapture.draft(from: empty.board, source: source) }
        empty.board.setString(String(repeating: "字", count: 100_001), forType: .string)
        try await rejects("10 万字") { _ = try ShortcutCapture.draft(from: empty.board, source: source) }
        empty.board.clearContents(); empty.board.setData(Data([1, 2, 3]), forType: .png)
        try await rejects("图片无法读取") { _ = try ShortcutCapture.draft(from: empty.board, source: source) }
        print("Shortcut capture: \(passed) checks passed (isolated pasteboards, no real keyboard events)")
    }
}
