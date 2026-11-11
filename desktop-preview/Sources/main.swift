import AppKit
import ApplicationServices
import WebKit
import UniformTypeIdentifiers

private struct WebRect {
    let x: CGFloat
    let y: CGFloat
    let width: CGFloat
    let height: CGFloat
    let radius: CGFloat
    let clipTop, clipBottom, clipLeft, clipRight: CGFloat
    let fadeBottom, fadeBottomOffset: CGFloat

    init?(_ value: Any) {
        guard let data = value as? [String: Any],
              let x = data["x"] as? Double,
              let y = data["y"] as? Double,
              let width = data["width"] as? Double,
              let height = data["height"] as? Double else { return nil }
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.radius = data["radius"] as? Double ?? 0
        self.clipTop = max(0, data["clipTop"] as? Double ?? 0)
        self.clipBottom = max(0, data["clipBottom"] as? Double ?? 0)
        self.clipLeft = max(0, data["clipLeft"] as? Double ?? 0)
        self.clipRight = max(0, data["clipRight"] as? Double ?? 0)
        self.fadeBottom = max(0, data["fadeBottom"] as? Double ?? 0)
        self.fadeBottomOffset = data["fadeBottomOffset"] as? Double ?? 0
    }

    var rect: CGRect { CGRect(x: x, y: y, width: width, height: height) }
}

private final class DesktopPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

private struct ResultOverlayReadContext {
    let inputRevision: Int
    let bundle: String?
    let windowID: CGWindowID?
    let frame: NSRect?
}

final class DesktopPreviewApp: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, NSDraggingSource, NSMenuItemValidation {
    private let officeSelectionPoint = OfficeSelectionPoint()
    private var officePasteCapturing = false
    private var inputAnchor: InputPasteAnchor?
    private var overlay: DesktopPanel!
    private var overlayWebView: WKWebView!
    private var glassViews: [NSView] = []
    private var interactiveRegions: [WebRect] = []
    private var statusItem: NSStatusItem?
    private var pointerTimer: Timer?
    private var overlayLoaded = false
    private var sidecar: Process?
    private let sourceApplicationIcons = SourceApplicationIcons()
    private var agentProcess: Process?
    private var clipboardPort = 47721
    private var prototypeRoot: URL?
    private var clipboardDirectory: URL?
    private var clipboardSignature = ""
    private var clipboardPoll: Timer?
    private var clipboardStarting = false
    private var clipboardPolling = false
    private var clipboardRetryAfter = Date.distantPast
    private var working = false
    private var workRevision = 0
    private var runtimeSessionId = ""
    private let resultOverlay = ResultOverlayManager()
    private var resultFeedback: [String: Any]?
    private var resultFeedbackID = ""
    private var displayedResultFeedbackID = ""
    private var observedAgentSnapshot = false
    private var resultFeedbackDeadline = Date.distantPast
    private var resultOverlayWatch: Timer?
    private var resultOverlayGlobalInput: Any?
    private var resultOverlayLocalInput: Any?
    private var resultInputRevision = 0
    private var lastResultInputAt: Double = 0
    private var resultWindowBinding: (bundle: String, pid: pid_t, id: CGWindowID)?
    private var logHandles: [String: FileHandle] = [:]
    private var packArmed = false
    private var packDragging = false
    private var packDragPreparing = false
    private var packGesture = 0
    private var packStart: NSPoint?
    private var packDragRegions: [WebRect] = []
    private var packDragExclusions: [WebRect] = []
    private let packDragVisual = PackDragVisual()
    private let nativePackDrop = NativePackDrop()
    private var packDragSession: NSDraggingSession?
    private var packDragSessionID: String?
    private var packDragEntries: [PackDragVisual.Entry] = []
    private var packPreviewImages: [String: NSImage] = [:]
    private var packPetRect: WebRect?
    private var packFlightUntil = Date.distantPast
    private var dragMonitor: Any?
    private var focusedAppName = ""
    private var focusSignature = ""
    private var focusRequestSignature = ""
    private var targetAppBundleID: String?
    private var targetWindowTitle: String?
    private var currentTargetKind = ""
    private var currentDestination = "system"
    private var currentAgentPhase = "idle"
    private var currentCanUndo = false
    private var currentAnchor = false
    private lazy var shortcutCapture = ShortcutCapture()
    private var shortcutCapturing = false
    private lazy var selectionCopy = SelectionCopy { [weak self] action, selection, complete in
        guard let self else { complete(false); return }
        Task {
            do {
                if action == "anchor" {
                    let result = try await self.requestJSON(path: "/v1/agent/anchor", method: "POST", body: ["focus": selection.anchorContext])
                    guard result["ok"] as? Bool == true else { throw ClipboardWorkError(result["error"] as? String ?? "位置没有标记") }
                    await self.pushClipboard()
                    await MainActor.run { self.showToast("已标记修改位置，去找参考吧。"); complete(true) }
                    return
                }
                let result = try await self.requestJSON(path: "/v1/clipboard/items", method: "POST", body: ["type": "text", "source": selection.source, "body": ["text": selection.text]])
                guard result["item"] != nil else { throw ClipboardWorkError(result["error"] as? String ?? "复制没有保存，请重试。") }
                await self.pushClipboard()
                await MainActor.run {
                    if result["pasteboardError"] != nil { self.showToast("已加入内容包，系统复制暂未成功。") }
                    complete(true)
                }
            } catch { await MainActor.run { self.showToast(error.localizedDescription); complete(false) } }
        }
    }
    private lazy var settings = DesktopSettings(root: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Tuotie/runtime")) { [weak self] action in
        guard let self else { return }
        switch action {
        case "addContent": self.captureFromCurrentApp()
        case "magicCopy": self.selectionCopy.copySelectionNow()
        case "pasteToWord": self.beginOfficePaste()
        case "toggle": self.callLive("toggleContent()")
        case "archive": self.showArchive()
        case "settings": self.showSettings()
        case "stop": self.callLive("stopCurrent()")
        default: break
        }
    }

    private var resourceDirectory: URL {
        Bundle.main.resourceURL ?? URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    }
    private var interfaceDirectory: URL {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Tuotie/runtime/ui")
        return FileManager.default.isReadableFile(atPath: directory.appendingPathComponent("components-preview.html").path) ? directory : resourceDirectory
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        resultOverlay.onOutcome = { [weak self] id, outcome in
            guard let self else { return }
            let row:[String:Any] = ["id":id,"outcome":outcome,"at":Date().timeIntervalSince1970,"screenCapture":CGPreflightScreenCaptureAccess()]
            if let data=try? JSONSerialization.data(withJSONObject:row),let handle=self.logHandle(named:"result-overlay.ndjson") {
                handle.write(data);handle.write(Data([10]))
            }
            if outcome == "unavailable" {self.showToast("内容已更新，暂未取得可核验的屏幕范围")}
        }
        NSApp.setActivationPolicy(.regular)
        if let icon=NSImage(contentsOf:resourceDirectory.appendingPathComponent("AppIcon.icns")) {NSApp.applicationIconImage=icon}
        makeMenus()
        makeOverlay()
        makeStatusItem()
        _ = settings
        selectionCopy.start()
        officeSelectionPoint.start()
        pointerTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            self?.updatePointerRouting()
        }
        dragMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp]) { [weak self] event in
            self?.handlePackPointer(event) ?? event
        }
        // The visual cursor never sends input. Real input invalidates its old
        // geometry before the user can scroll, rotate or edit the target view.
        let feedbackEvents: NSEvent.EventTypeMask = [.leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel, .keyDown, .magnify, .rotate, .gesture]
        resultOverlayGlobalInput = NSEvent.addGlobalMonitorForEvents(matching: feedbackEvents) { [weak self] _ in self?.invalidateResultGeometry() }
        resultOverlayLocalInput = NSEvent.addLocalMonitorForEvents(matching: feedbackEvents) { [weak self] event in
            self?.invalidateResultGeometry(); return event
        }
        clipboardPoll = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.pollClipboard()
        }
        RunLoop.main.add(clipboardPoll!, forMode: .common)
        Task { await self.startClipboard() }
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationWillTerminate(_ notification: Notification) {
        pointerTimer?.invalidate()
        clipboardPoll?.invalidate()
        selectionCopy.stop()
        officeSelectionPoint.stop()
        packDragVisual.close()
        nativePackDrop.stop()
        hideResultOverlay()
        if let monitor = resultOverlayGlobalInput { NSEvent.removeMonitor(monitor) }
        if let monitor = resultOverlayLocalInput { NSEvent.removeMonitor(monitor) }
        if sidecar?.isRunning == true { sidecar?.terminate() }
        overlayWebView.configuration.userContentController.removeScriptMessageHandler(forName: "tuotie")
    }

    private func captureFromCurrentApp() {
        guard !shortcutCapturing else { return }
        guard let app = NSWorkspace.shared.frontmostApplication,
              app.bundleIdentifier != Bundle.main.bundleIdentifier else {
            showToast("请先在其他 App 中选择要加入的文字或图片。"); return
        }
        var source: [String: Any] = ["appName": app.localizedName ?? "当前应用", "bundleId": app.bundleIdentifier ?? "", "captureMethod": "global-shortcut"]
        let context = foregroundContext(app)
        if let title = context["windowTitle"] as? String { source["title"] = title }
        if let url = SourceLocation.read(from: app) { source["url"] = url }
        else if let path = context["documentPath"] as? String { source["url"] = URL(fileURLWithPath: path).absoluteString }
        shortcutCapturing = true
        Task { @MainActor in
            defer { self.shortcutCapturing = false }
            do {
                let draft = try await self.shortcutCapture.capture(pid: app.processIdentifier, source: source)
                let result = try await self.requestJSON(path: "/v1/clipboard/items", method: "POST", body: draft)
                guard let item = result["item"] as? [String: Any] else { throw ShortcutCaptureError(result["error"] as? String ?? "内容没有保存，请重试。") }
                if draft["type"] as? String == "image", (item["body"] as? [String: Any])?["hasContent"] as? Bool != true { throw ShortcutCaptureError("图片没有完整保存，请重试。") }
                await self.pushClipboard()
                self.showToast(result["pasteboardError"] == nil ? "已加入内容包。" : "已加入内容包，系统剪贴板未更新。")
            } catch { self.showToast(error.localizedDescription) }
        }
    }

    private func beginOfficePaste() {
        guard !officePasteCapturing, overlayLoaded else { return }
        let originalApp = NSWorkspace.shared.frontmostApplication
        officePasteCapturing = true
        overlayWebView.evaluateJavaScript("Boolean(window.TuotieDesktopLive?.resumeOfficePaste?.())") { [weak self] result, _ in
            guard let self else { return }
            if result as? Bool == true {
                self.officePasteCapturing = false
                self.overlay.makeKeyAndOrderFront(nil)
            } else {
                self.officePasteCapturing = false
                self.captureOfficePaste(in: originalApp)
            }
        }
    }

    private func captureOfficePaste(in originalApp:NSRunningApplication?) {
        guard let app=originalApp, app.processIdentifier != ProcessInfo.processInfo.processIdentifier,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else {
            showToast("请先点击目标输入框，再使用 AI 粘贴。");return
        }
        if app.bundleIdentifier == "org.blenderfoundation.blender" {
            beginBlenderPaste(app); return
        }
        let structuredHosts=["com.microsoft.Word":"word","com.microsoft.Excel":"excel","com.microsoft.Powerpoint":"powerpoint","com.adobe.illustrator":"illustrator","com.figma.Desktop":"figma"]
        let structured=structuredHosts[app.bundleIdentifier ?? ""]
        let host=structured != nil && !InputPasteAnchor.isSearchField(in:app) ? structured! : "input"
        let isExcel=host=="excel"
        var capture:InputPasteAnchor?
        let placement:(point:NSPoint,exact:Bool)
        var context:[String:Any]=[:]
        if host=="input" {
            do {
                let input=try InputPasteAnchor(app:app);capture=input
            } catch {showToast(error.localizedDescription);return}
            placement=officeSelectionPoint.placement(for:app) ?? (NSEvent.mouseLocation,false)
        } else {
            guard let point=officeSelectionPoint.placement(for:app) else {
                showToast("请在目标文稿中选择编辑位置或对象后，再使用 AI 粘贴。");return
            }
            placement=point;context=foregroundContext(app)
        }
        let point = overlay.convertPoint(fromScreen: placement.point)
        let position: [String: Any] = ["x":point.x + 10, "y":overlay.frame.height - point.y + 8, "exact":placement.exact]
        officePasteCapturing = true
        Task { @MainActor in
            defer { self.officePasteCapturing = false }
            do {
                if let input=capture {
                    await input.prepare()
                    guard NSWorkspace.shared.frontmostApplication?.processIdentifier==app.processIdentifier else {throw InputPasteFailure("捕获期间已切换应用，请在目标输入框重试。")}
                    context=["id":input.id,"focus":input.context(),"manual":input.manual]
                }
                // Leaving Excel's in-cell editor commits the user's pending text
                // while retaining the selected cell/range for Office.js capture.
                if isExcel {
                    self.overlay.ignoresMouseEvents = false
                    self.overlay.makeKeyAndOrderFront(nil)
                }
                let endpoint = "/v1/agent/\(host)-paste"
                let result = try await self.requestJSON(path:endpoint, method:"POST", body:context)
                guard result["ok"] as? Bool == true else { throw ClipboardWorkError(result["error"] as? String ?? "目标位置没有保存") }
                self.inputAnchor?.release();self.inputAnchor=capture
                await self.pushClipboard()
                let data = try JSONSerialization.data(withJSONObject:position)
                self.overlay.ignoresMouseEvents = false
                self.overlay.makeKeyAndOrderFront(nil)
                self.callLive("openOfficePaste(\(String(data:data,encoding:.utf8)!), '\(host)')")
            } catch { capture?.release();self.showToast(error.localizedDescription) }
        }
    }

    private func beginBlenderPaste(_ app: NSRunningApplication) {
        let context = foregroundContext(app)
        officePasteCapturing = true
        Task { @MainActor in
            defer { self.officePasteCapturing = false }
            do {
                // Capture the real viewport centre before making our panel key.
                // Blender's confirmation names this location explicitly.
                let result = try await self.requestJSON(path: "/v1/agent/blender-paste", method: "POST", body: context)
                guard result["ok"] as? Bool == true else {
                    throw ClipboardWorkError(result["error"] as? String ?? "Blender 目标没有保存")
                }
                await self.pushClipboard()
                self.overlay.ignoresMouseEvents = false
                self.overlay.makeKeyAndOrderFront(nil)
                self.callLive("openBlenderPaste()")
            } catch { self.showToast(error.localizedDescription) }
        }
    }

    private func makeOverlay() {
        let frame = NSScreen.main?.visibleFrame ?? CGRect(x: 0, y: 0, width: 1280, height: 800)
        let panel = DesktopPanel(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        panel.title = "妥帖"
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = false
        panel.acceptsMouseMovedEvents = true
        panel.ignoresMouseEvents = true

        let root = NSView(frame: CGRect(origin: .zero, size: frame.size))
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor.clear.cgColor
        panel.contentView = root

        let controller = WKUserContentController()
        controller.add(self, name: "tuotie")
        if let source = try? String(contentsOf: interfaceDirectory.appendingPathComponent("desktop-overlay.js"), encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        if let source = try? String(contentsOf: interfaceDirectory.appendingPathComponent("desktop-live.js"), encoding: .utf8) {
            controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        let webView = WKWebView(frame: root.bounds, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.autoresizingMask = [.width, .height]
        webView.underPageBackgroundColor = .clear
        // WKWebView otherwise paints a white page backing even for transparent HTML.
        // This KVC key is used only by the local desktop preview host.
        webView.setValue(false, forKey: "drawsBackground")
        webView.wantsLayer = true
        webView.layer?.backgroundColor = NSColor.clear.cgColor
        root.addSubview(webView)

        let page = interfaceDirectory.appendingPathComponent("components-preview.html")
        webView.loadFileURL(page, allowingReadAccessTo: interfaceDirectory)
        overlay = panel
        overlayWebView = webView
        panel.orderFrontRegardless()
    }

    private func makeMenus() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "退出妥帖", action: #selector(quit), keyEquivalent: "q"))
        appItem.submenu = appMenu

        // Standard responder-chain actions also serve the settings field editor
        // and WKWebView. Without these menu equivalents, Command-V is ignored.
        let editItem = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(NSMenuItem(title: "撤销", action: Selector(("undo:")), keyEquivalent: "z"))
        let redoItem = NSMenuItem(title: "重做", action: Selector(("redo:")), keyEquivalent: "z")
        redoItem.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(redoItem)
        editMenu.addItem(.separator())
        for (title, action, key) in [("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            editMenu.addItem(NSMenuItem(title: title, action: Selector(action), keyEquivalent: key))
        }
        editItem.submenu = editMenu
        main.addItem(editItem)

        let previewItem = NSMenuItem(title: "任务", action: nil, keyEquivalent: "")
        main.addItem(previewItem)
        previewItem.submenu = previewMenu()
        NSApp.mainMenu = main
    }

    private func makeStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let image=NSImage(contentsOf:resourceDirectory.appendingPathComponent("StatusIcon.png")) {
            image.size=NSSize(width:18,height:18);image.isTemplate=true
            item.button?.image=image;item.button?.setAccessibilityLabel("妥帖")
        } else {item.button?.title="妥帖"}
        item.menu = previewMenu()
        statusItem = item
    }

    private func previewMenu() -> NSMenu {
        let menu = NSMenu(title: "妥帖")
        func add(_ title: String, _ action: Selector) {
            let item=NSMenuItem(title:title,action:action,keyEquivalent:"")
            item.target=self;menu.addItem(item)
        }
        add("显示内容包", #selector(showContent))
        add("查看归档…", #selector(showArchive))
        add("取消标记位置", #selector(clearEditAnchor))
        menu.addItem(.separator())
        add("目标：系统剪贴板", #selector(targetSystem))
        add("目标：留在妥帖", #selector(targetHold))
        add("目标：Blender", #selector(targetBlender))
        add("选择目标文档、幻灯片或表格…", #selector(chooseOfficeTarget))
        add("打开当前目标", #selector(openCurrentTarget))
        menu.addItem(.separator())
        add("停止当前任务", #selector(stopCurrent))
        add("撤销最近修改", #selector(undoRecent))
        menu.addItem(.separator())
        add("设置…", #selector(showSettings))
        add("退出妥帖", #selector(quit))
        return menu
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if item.action == #selector(clearEditAnchor) { return currentAnchor && !["running","preview","done"].contains(currentAgentPhase) }
        let targets:[Selector:String]=[#selector(targetSystem):"system",#selector(targetHold):"hold",#selector(targetBlender):"blender"]
        if let id=targets[item.action ?? #selector(quit)] {item.state=currentDestination == id ? .on : .off;return !["planning","running","preview"].contains(currentAgentPhase)}
        if item.action == #selector(chooseOfficeTarget) {return !["planning","running","preview"].contains(currentAgentPhase)}
        if item.action == #selector(stopCurrent) {return currentAgentPhase == "running"}
        if item.action == #selector(undoRecent) {return currentCanUndo && !["running","planning","preview"].contains(currentAgentPhase)}
        if item.action == #selector(openCurrentTarget) {return ["blender","office","focused","jianying"].contains(currentDestination)}
        return true
    }

    private func callLive(_ expression: String) {
        guard overlayLoaded else { return }
        overlay.orderFrontRegardless()
        overlayWebView.evaluateJavaScript("window.TuotieDesktopLive?.\(expression)",completionHandler:nil)
    }
    @objc private func showContent(){callLive("showContent()")}
    @objc private func showSettings(){settings.show()}
    @objc private func clearEditAnchor(){
        Task {
            let result = try? await requestJSON(path: "/v1/agent/anchor", method: "POST", body: ["focus": NSNull()])
            if let error = result?["error"] as? String { showToast(error) }
            else { showToast("已取消标记位置") }
            await pushClipboard()
        }
    }
    @objc private func stopCurrent(){callLive("stopCurrent()")}
    @objc private func undoRecent(){callLive("undoRecent()")}
    @objc private func openCurrentTarget(){if currentDestination == "blender" {startAgent()} else if currentDestination == "office" && !currentTargetKind.hasSuffix("-live") {openAgentFile(preview:false)} else {focusCurrentApplication()}}
    private func focusCurrentApplication(){
        guard let bundle=targetAppBundleID else {return}
        if let app=NSRunningApplication.runningApplications(withBundleIdentifier:bundle).first {
            app.activate(options:[.activateIgnoringOtherApps])
            if currentTargetKind.hasSuffix("-live"), let title=targetWindowTitle, AXIsProcessTrusted() {
                var value:CFTypeRef?
                let application=AXUIElementCreateApplication(app.processIdentifier)
                if AXUIElementCopyAttributeValue(application,kAXWindowsAttribute as CFString,&value) == .success,
                   let windows=value as? [AXUIElement],let window=windows.first(where:{axString($0,kAXTitleAttribute as CFString)==title}) {
                    AXUIElementPerformAction(window,kAXRaiseAction as CFString)
                }
            }
        }
        else if let url=NSWorkspace.shared.urlForApplication(withBundleIdentifier:bundle) {NSWorkspace.shared.openApplication(at:url,configuration:NSWorkspace.OpenConfiguration())}
    }
    @objc private func showArchive(){
        Task {
            do {
                let result=try await requestJSON(path:"/v1/clipboard/items?includeArchived=1",method:"GET",body:nil)
                let items=(result["items"] as? [[String:Any]] ?? []).filter{$0["archivedAt"] != nil}
                let data=try JSONSerialization.data(withJSONObject:items)
                let json=String(data:data,encoding:.utf8)!
                await MainActor.run {self.callLive("showArchive(JSON.parse(\(self.jsString(json))))")}
            } catch {showToast("归档没有打开，请稍后重试。")}
        }
    }

    @objc private func targetSystem() { setDesktopTarget("system") }
    @objc private func targetHold() { setDesktopTarget("hold") }
    @objc private func targetBlender() { setDesktopTarget("blender") }

    private func setDesktopTarget(_ id: String) {
        guard overlayLoaded else { return }
        Task {
            do {
                if id != "office" {
                    let result = try await requestJSON(path: "/v1/agent/target", method: "POST", body: ["id": id])
                    if let error = result["error"] as? String { throw ClipboardWorkError(error) }
                }
                await MainActor.run {
                    self.overlayWebView.evaluateJavaScript("window.TuotieUI&&TuotieUI.dispatch({type:'target/set', id:\(self.jsString(id))})", completionHandler: nil)
                }
            } catch { showToast(error.localizedDescription) }
        }
    }

    @objc private func chooseOfficeTarget() {
        let panel = NSOpenPanel()
        panel.title = "选择已保存的目标文件"
        panel.prompt = "设为目标"
        panel.allowedContentTypes = ["docx", "pptx", "xlsx"].compactMap { UTType(filenameExtension: $0) }
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let file = panel.url else { return }
        Task {
            do {
                let selected = try await requestJSON(path: "/v1/agent/target", method: "POST", body: ["id": "office", "path": file.path])
                if let error = selected["error"] as? String { throw ClipboardWorkError(error) }
                await pushClipboard()
                _ = await MainActor.run { NSWorkspace.shared.open(file) }
            } catch { showToast(error.localizedDescription) }
        }
    }

    @objc private func startAgent() {
        guard agentProcess?.isRunning != true, let prototypeRoot else { return }
        if blenderPortOpen() { focusBlender(); return }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/Applications/Blender.app/Contents/MacOS/Blender")
        process.arguments = ["--python", prototypeRoot.appendingPathComponent("blender/start.py").path]
        process.currentDirectoryURL = prototypeRoot
        if let handle = logHandle(named: "agent-launch.log") {
            process.standardOutput = handle
            process.standardError = handle
        }
        do { try process.run(); agentProcess = process }
        catch { NSLog("Blender 没有打开：%@", error.localizedDescription) }
    }

    private func blenderPortOpen() -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        process.arguments = ["-nP", "-iTCP:9876", "-sTCP:LISTEN"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return false }
        process.waitUntilExit()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return process.terminationStatus == 0 && !data.isEmpty
    }

    @objc private func quit() { NSApp.terminate(nil) }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = "妥帖"
        alert.informativeText = message
        alert.addButton(withTitle: "替换")
        alert.addButton(withTitle: "取消")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === overlayWebView else { return }
        webView.evaluateJavaScript("Boolean(window.TuotieUI && window.TuotieDesktopPreview)") { [weak self] result, error in
            self?.overlayLoaded = (result as? Bool == true) && error == nil
            if self?.overlayLoaded == false { NSLog("妥帖桌面脚本未加载") }
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if url.scheme == "tuotie-app", url.host == "open",
               let bundle = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "bundleId" })?.value,
               let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundle) {
                NSWorkspace.shared.openApplication(at: appURL, configuration: NSWorkspace.OpenConfiguration())
            } else if ["http", "https", "file"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        }
        return nil
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "tuotie", let payload = message.body as? [String: Any] else { return }
        if payload["type"] as? String == "targetSelected", let destination = payload["destinationId"] as? String {
            Task {
                do {
                    let result = try await self.requestJSON(path: "/v1/agent/target", method: "POST", body: ["id": destination])
                    if let error = result["error"] as? String { self.showToast(error) }
                } catch { self.showToast(error.localizedDescription) }
            }
            return
        }
        if payload["type"] as? String == "copyInputResult" {
            Task { @MainActor in
                guard let status=await fetchJSON(path:"/v1/agent/status"), status["targetKind"] as? String=="input-live",
                      ["done","error","ready"].contains(status["phase"] as? String ?? ""),
                      let draft=status["previewText"] as? String, !draft.isEmpty else {return}
                NSPasteboard.general.clearContents()
                guard NSPasteboard.general.setString(draft,forType:.string) else {showToast("系统剪贴板没有写入，请再点一次复制。");return}
                showToast("已复制生成文字，可回到输入框粘贴。")
            }
            return
        }
        if payload["type"] as? String == "focusTarget" {
            if payload["destinationId"] as? String == "blender" { focusBlender() }
            else if payload["destinationId"] as? String == "office" && !currentTargetKind.hasSuffix("-live") { openAgentFile(preview: false) }
            else { focusCurrentApplication() }
            presentResultOverlay()
            return
        }
        if payload["type"] as? String == "openTargetPreview" {
            openAgentFile(preview: true)
            return
        }
        if payload["type"] as? String == "sceneSupplement" {
            let instruction = payload["instruction"] as? String ?? ""
            Task {
                do {
                    let result = try await self.requestJSON(path: "/v1/agent/supplement", method: "POST", body: ["instruction": instruction])
                    self.showToast((result["error"] as? String) ?? "已收到补充要求")
                } catch { self.showToast(error.localizedDescription) }
            }
            return
        }
        if payload["type"] as? String == "dismissDrop" {
            let eventId = payload["eventId"] as? String ?? ""
            Task { _ = try? await self.requestJSON(path: "/v1/agent/drop/dismiss", method: "POST", body: ["eventId": eventId]) }
            return
        }
        if payload["type"] as? String == "clearEditAnchor" {
            Task {
                let result = try? await requestJSON(path: "/v1/agent/anchor", method: "POST", body: ["focus": NSNull()])
                if let error = result?["error"] as? String { showToast(error) }
                await pushClipboard()
            }
            return
        }
        if payload["type"] as? String == "archiveItems",let ids=payload["itemIds"] as? [String] {
            Task {_ = try? await requestJSON(path:"/v1/clipboard/archive",method:"POST",body:["itemIds":ids]);await pushClipboard()}
            return
        }
        if payload["type"] as? String == "work" {
            bindResultWindow()
            let destination = payload["destinationId"] as? String ?? "system"
            let ids = payload["sourceIds"] as? [String] ?? []
            let bundleIds = payload["bundleIds"] as? [String] ?? ids
            let actionIndex = (payload["actionIndex"] as? NSNumber)?.intValue ?? 0
            let dropEventId = payload["dropEventId"] as? String ?? ""
            let instruction = payload["instruction"] as? String ?? ""
            performWork(destinationId: destination, sourceIds: ids, bundleIds: bundleIds, actionIndex: actionIndex, instruction: instruction, dropEventId: dropEventId, continuation: payload["continuation"] as? Bool ?? false)
            return
        }
        if payload["type"] as? String == "sceneControl" {
            let action = payload["action"] as? String ?? ""
            if action == "commit", resultWindowBinding == nil { bindResultWindow() }
            if ["cancel", "undo", "finish"].contains(action) { invalidateResultGeometry() }
            Task {
                do {
                    let result = try await self.requestJSON(path: "/v1/agent/control", method: "POST", body: ["action": action])
                    if let error = result["error"] as? String { throw ClipboardWorkError(error) }
                    if ["cancel", "undo", "finish"].contains(action) {
                        self.workRevision += 1
                        self.working = false
                    }
                    if let filename = result["openPath"] as? String {
                        _ = await MainActor.run { NSWorkspace.shared.open(URL(fileURLWithPath: filename)) }
                    }
                    await self.pushClipboard()
                    let script = "window.TuotieDesktopLive?.controlFinished(\(self.jsString(action)))"
                    await MainActor.run { self.overlayWebView.evaluateJavaScript(script, completionHandler: nil) }
                } catch {
                    let script = "window.TuotieDesktopLive?.controlFailed(\(self.jsString(error.localizedDescription)))"
                    await MainActor.run { self.overlayWebView.evaluateJavaScript(script, completionHandler: nil) }
                }
            }
            return
        }
        if payload["type"] as? String == "geometry" {
            writeDirectionButtons(payload["directionButtons"] as? [Any] ?? [])
            writeDropButtons(payload["dropButtons"] as? [Any] ?? [])
            writeBundle(payload["bundle"])
            writeNamedRect(payload["pet"], named: "pet-rect.json")
            packPetRect = payload["pet"].flatMap(WebRect.init)
        }
        guard payload["type"] as? String == "geometry" else { return }
        packDragRegions = (payload["packDragRegions"] as? [Any] ?? []).compactMap(WebRect.init)
        packDragExclusions = (payload["packDragExclusions"] as? [Any] ?? []).compactMap(WebRect.init)
        interactiveRegions = (payload["regions"] as? [Any] ?? []).compactMap(WebRect.init)
        let surfaces = (payload["surfaces"] as? [Any] ?? []).compactMap(WebRect.init)
        updateGlass(surfaces)
        updatePointerRouting()
    }

    private func updateGlass(_ surfaces: [WebRect]) {
        guard let root = overlay?.contentView else { return }
        while glassViews.count < surfaces.count {
            let view = NativeGlass.make()
            root.addSubview(view, positioned: .below, relativeTo: overlayWebView)
            glassViews.append(view)
        }
        for (index, view) in glassViews.enumerated() {
            guard index < surfaces.count else { view.isHidden = true; continue }
            let surface = surfaces[index]
            view.isHidden = false
            view.frame = CGRect(x: surface.x, y: root.bounds.height - surface.y - surface.height, width: surface.width, height: surface.height)
            NativeGlass.setRadius(surface.radius, on: view)
            NativeGlass.setClipping(top: surface.clipTop, bottom: surface.clipBottom, left: surface.clipLeft, right: surface.clipRight, fadeBottom: surface.fadeBottom, fadeBottomOffset: surface.fadeBottomOffset, on: view)
        }
    }

    private func updatePointerRouting() {
        guard let overlay else { return }
        if packDragging || Date() < packFlightUntil {
            overlay.ignoresMouseEvents = true
            return
        }
        let cursor = NSEvent.mouseLocation
        let x = cursor.x - overlay.frame.minX
        let y = overlay.frame.maxY - cursor.y
        let point = CGPoint(x: x, y: y)
        let overUI = interactiveRegions.contains { $0.rect.insetBy(dx: -2, dy: -2).contains(point) }
        let dragging = NSEvent.pressedMouseButtons & 1 != 0 && !overlay.ignoresMouseEvents
        overlay.ignoresMouseEvents = !(overUI || dragging)
    }

    private struct RuntimeConfig: Decodable {
        let port: Int
    }

    private func loadRuntime() -> RuntimeConfig? {
        let file = resourceDirectory.appendingPathComponent("runtime.json")
        guard let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(RuntimeConfig.self, from: data)
    }

    private func startClipboard() async {
        guard !clipboardStarting else { return }
        clipboardStarting = true
        defer { clipboardStarting = false }
        guard let config = loadRuntime() else {
            NSLog("妥帖没有 runtime.json，剪贴板服务没有启动")
            return
        }
        clipboardPort = config.port
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let root = support.appendingPathComponent("Tuotie/runtime", isDirectory: true)
        prototypeRoot = root
        clipboardDirectory = root.appendingPathComponent(".local/clipboard", isDirectory: true)
        if await clipboardHealthy() { return }
        guard sidecar?.isRunning != true, Date() >= clipboardRetryAfter else { return }
        clipboardRetryAfter = Date().addingTimeInterval(5)
        guard let node = nodeExecutable() else {
            NSLog("没有找到 Node，浏览器复制无法保存")
            return
        }
        let tsx = root.appendingPathComponent("node_modules/tsx/dist/cli.mjs")
        let script = root.appendingPathComponent("scripts/clipboard-serve.ts")
        guard FileManager.default.isReadableFile(atPath: tsx.path), FileManager.default.isReadableFile(atPath: script.path) else {
            NSLog("妥帖剪贴板脚本不在 %@", root.path)
            return
        }
        let process = Process()
        process.executableURL = node
        process.arguments = ["--import", "tsx", script.path]
        process.currentDirectoryURL = root
        var environment = ProcessInfo.processInfo.environment
        environment["OKPASTE_CLIPBOARD_DIR"] = clipboardDirectory!.path
        environment["OKPASTE_CLIPBOARD_PORT"] = String(config.port)
        environment["NODE_DISABLE_COMPILE_CACHE"] = "1"
        environment["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin:" + (environment["PATH"] ?? "")
        process.environment = environment
        if let handle = logHandle(named: "desktop-clipboard.log") {
            process.standardOutput = handle
            process.standardError = handle
        }
        do {
            try process.run()
            sidecar = process
        } catch {
            NSLog("妥帖剪贴板没有启动：%@", error.localizedDescription)
        }
    }

    private func nodeExecutable() -> URL? {
        ["/usr/local/bin/node", "/opt/homebrew/bin/node", "/usr/bin/node"]
            .map { URL(fileURLWithPath: $0) }
            .first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }

    private func logHandle(named name: String) -> FileHandle? {
        if let handle = logHandles[name] { return handle }
        guard let prototypeRoot else {
            let fallback = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(name)
            FileManager.default.createFile(atPath: fallback.path, contents: nil)
            return FileHandle(forWritingAtPath: fallback.path)
        }
        let directory = prototypeRoot.appendingPathComponent(".local", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent(name)
        if !FileManager.default.fileExists(atPath: file.path) { FileManager.default.createFile(atPath: file.path, contents: nil) }
        let handle = FileHandle(forWritingAtPath: file.path)
        handle?.seekToEndOfFile()
        if let handle { logHandles[name] = handle }
        return handle
    }

    private func clipboardHealthy() async -> Bool {
        guard let url = URL(string: "http://127.0.0.1:\(clipboardPort)/health") else { return false }
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.6
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    private func pollClipboard() {
        guard overlayLoaded, !clipboardPolling else { return }
        clipboardPolling = true
        Task { @MainActor in
            defer { self.clipboardPolling = false }
            guard await self.clipboardHealthy() else { await self.startClipboard(); return }
            self.publishFocus()
            await self.pollInputWrite()
            await self.pushClipboard()
        }
    }

    @MainActor private func pollInputWrite() async {
        guard let anchor=inputAnchor, !anchor.polling else {return}
        anchor.polling=true;defer {anchor.polling=false}
        var body:[String:Any]=["id":anchor.id]
        if let receipt=anchor.receipt {body["receipt"]=receipt}
        do {
            let result=try await requestJSON(path:"/v1/agent/input-exchange",method:"POST",body:body)
            guard inputAnchor === anchor, let active=result["active"] as? Bool else {return}
            guard active else {anchor.release();inputAnchor=nil;return}
            if let command=result["command"] as? [String:Any], let id=command["id"] as? String {
                if anchor.receipt?["id"] as? String == id {return}
                do {
                    try await anchor.apply(command)
                    anchor.receipt=["id":id,"ok":true]
                } catch {
                    anchor.receipt=["id":id,"ok":false,"error":error.localizedDescription,"mutationStarted":(error as? InputPasteFailure)?.mutationStarted ?? true]
                }
                // Keep the receipt until a successful exchange. Losing a reply must not repeat a paste.
                if let receipt=anchor.receipt { _ = try await requestJSON(path:"/v1/agent/input-exchange",method:"POST",body:["id":anchor.id,"receipt":receipt]) }
            }
        } catch { /* The next poll resends only the receipt. */ }
    }

    private func axString(_ element:AXUIElement,_ attribute:CFString)->String? {
        var value:CFTypeRef?
        guard AXUIElementCopyAttributeValue(element,attribute,&value) == .success else {return nil}
        return value as? String
    }
    private func foregroundContext(_ app:NSRunningApplication)->[String:Any] {
        var context:[String:Any]=["appName":app.localizedName ?? "当前应用","bundleId":app.bundleIdentifier ?? "","accessibility":AXIsProcessTrusted()]
        if let windows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]],let window=windows.first(where:{($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == app.processIdentifier && ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0}),let title=window[kCGWindowName as String] as? String {context["windowTitle"]=title}
        if AXIsProcessTrusted() {
            let application=AXUIElementCreateApplication(app.processIdentifier)
            var windowValue:CFTypeRef?
            if AXUIElementCopyAttributeValue(application,kAXFocusedWindowAttribute as CFString,&windowValue) == .success,let value=windowValue,CFGetTypeID(value)==AXUIElementGetTypeID() {
                let window=value as! AXUIElement
                if let title=axString(window,kAXTitleAttribute as CFString){context["windowTitle"]=title}
                if let document=axString(window,kAXDocumentAttribute as CFString),let url=URL(string:document),url.isFileURL {context["documentPath"]=url.path}
            }
            var focusedValue:CFTypeRef?
            if AXUIElementCopyAttributeValue(application,kAXFocusedUIElementAttribute as CFString,&focusedValue) == .success,let value=focusedValue,CFGetTypeID(value)==AXUIElementGetTypeID() {
                let focused=value as! AXUIElement,role=axString(focused,kAXRoleAttribute as CFString) ?? ""
                context["role"]=role
                if role != "AXSecureTextField" && axString(focused,kAXSubroleAttribute as CFString) != "AXSecureTextField" {
                    if let text=axString(focused,kAXSelectedTextAttribute as CFString){context["selectedText"]=String(text.prefix(8000))}
                    if let text=axString(focused,kAXValueAttribute as CFString){context["focusedText"]=String(text.prefix(8000))}
                }
            }
        }
        return context
    }
    private func publishFocus() {
        guard let webView=overlayWebView,let front=NSWorkspace.shared.frontmostApplication else {return}
        let bundle=front.bundleIdentifier ?? "",name=front.localizedName ?? ""
        guard bundle != Bundle.main.bundleIdentifier,name != "妥帖",!name.hasPrefix("Tuotie") else {return}
        focusedAppName=name
        followScreen(of:front)
        let context=foregroundContext(front)
        guard let data=try? JSONSerialization.data(withJSONObject:context,options:.sortedKeys),let json=String(data:data,encoding:.utf8) else {return}
        webView.evaluateJavaScript("window.TuotieDesktopLive?.setFocus(\(jsString(name)),JSON.parse(\(jsString(json))))",completionHandler:nil)
        guard focusSignature != json,focusRequestSignature != json else {return}
        focusRequestSignature=json
        Task {
            do {
                let result = try await requestJSON(path:"/v1/agent/focus",method:"POST",body:context)
                if let error=result["error"] as? String {throw ClipboardWorkError(error)}
                await MainActor.run {if self.focusRequestSignature==json {self.focusSignature=json;self.focusRequestSignature=""}}
                await pushClipboard()
            } catch {await MainActor.run {if self.focusRequestSignature==json {self.focusRequestSignature=""}}}
        }
    }

    private func followScreen(of app: NSRunningApplication) {
        guard let overlay, !packDragging, Date() >= packFlightUntil, NSEvent.pressedMouseButtons == 0,
              NSScreen.screens.count > 1,
              let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
              let window = windows.first(where: {
                  guard ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == app.processIdentifier,
                        ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
                        let bounds = $0[kCGWindowBounds as String] as? [String: Any],
                        let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary) else { return false }
                  return rect.width > 100 && rect.height > 100
              }),
              let bounds = window[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary),
              rect.width > 100, rect.height > 100 else { return }
        // WindowServer uses the top-left of the primary display; AppKit uses bottom-left.
        let primaryTop = NSScreen.screens[0].frame.maxY
        let frame = CGRect(x: rect.minX, y: primaryTop - rect.maxY, width: rect.width, height: rect.height)
        guard let screen = NSScreen.screens.max(by: {
            let a = $0.frame.intersection(frame), b = $1.frame.intersection(frame)
            return (a.isNull ? 0 : a.width * a.height) < (b.isNull ? 0 : b.width * b.height)
        }), overlay.frame != screen.visibleFrame else { return }
        overlay.setFrame(screen.visibleFrame, display: true)
    }

    private func pushClipboard() async {
        let feedbackRead = await MainActor.run { () -> ResultOverlayReadContext in
            let bundle = self.targetAppBundleID
            let target = bundle.flatMap { self.resultWindow($0) }
            return ResultOverlayReadContext(inputRevision: self.resultInputRevision, bundle: bundle, windowID: target?.0, frame: target?.1)
        }
        let probe = await fetchJSON(path: "/v1/clipboard/items?preview=0")
        let ids = ((probe?["items"] as? [[String: Any]]) ?? []).compactMap { $0["id"] as? String }.sorted().joined(separator: ",")
        let includePreview = ids != clipboardSignature
        if includePreview { clipboardSignature = ids }
        async let items = fetchJSON(path: includePreview ? "/v1/clipboard/items" : "/v1/clipboard/items?preview=0")
        async let destinations = fetchJSON(path: "/v1/clipboard/destinations")
        async let agent = fetchJSON(path: "/v1/agent/status")
        guard var snapshot = await items else { return }
        snapshot["items"] = await MainActor.run {
            let items = ((snapshot["items"] as? [[String: Any]]) ?? []).map { self.sourceApplicationIcons.decorate($0) }
            let ids = Set(items.compactMap { $0["id"] as? String })
            self.packPreviewImages = self.packPreviewImages.filter { ids.contains($0.key) }
            self.packDragEntries = items.map { item in
                let id = item["id"] as? String ?? ""
                if self.packPreviewImages[id] == nil, let preview = item["preview"] as? String,
                   let comma = preview.firstIndex(of: ","),
                   let bytes = Data(base64Encoded: String(preview[preview.index(after: comma)...])),
                   let image = NSImage(data: bytes) {
                    let size = image.size
                    let scale = min(72 / max(1, size.width), 72 / max(1, size.height))
                    let thumbnail = NSImage(size: NSSize(width: max(1, size.width * scale), height: max(1, size.height * scale)), flipped: false) { rect in
                        image.draw(in: rect); return true
                    }
                    self.packPreviewImages[id] = thumbnail
                }
                let body = item["body"] as? [String: Any] ?? [:]
                let source = item["source"] as? [String: Any] ?? [:]
                let title = (body["text"] as? String) ?? (body["alt"] as? String) ?? (source["title"] as? String) ?? "\(items.count) 项"
                return PackDragVisual.Entry(title: String(title.prefix(100)), image: self.packPreviewImages[id])
            }
            return items
        }
        if let destinations = await destinations { snapshot["destinations"] = destinations["destinations"] ?? [] }
        if let agent = await agent, agent["phase"] != nil {
            snapshot["agent"] = agent
            await MainActor.run {
                if let session = agent["runtimeSessionId"] as? String {
                    if !self.runtimeSessionId.isEmpty, self.runtimeSessionId != session {
                        self.workRevision += 1
                        self.working = false
                        self.observedAgentSnapshot = false
                        self.resultFeedback = nil
                        self.resultWindowBinding = nil
                        self.hideResultOverlay()
                    }
                    self.runtimeSessionId = session
                }
                self.currentDestination=agent["destinationId"] as? String ?? "system"
                self.currentAgentPhase=agent["phase"] as? String ?? "idle"
                self.currentTargetKind=agent["targetKind"] as? String ?? ""
                self.targetWindowTitle=(agent["focus"] as? [String:Any])?["windowTitle"] as? String
                self.currentCanUndo=agent["canUndo"] as? Bool ?? false
                self.currentAnchor=agent["anchor"] != nil
                if agent["targetKind"] as? String == "word-live" {
                    self.targetAppBundleID = "com.microsoft.Word"
                } else if agent["targetKind"] as? String == "excel-live" {
                    self.targetAppBundleID = "com.microsoft.Excel"
                } else if agent["targetKind"] as? String == "powerpoint-live" {
                    self.targetAppBundleID = "com.microsoft.Powerpoint"
                } else if agent["destinationId"] as? String == "blender" {
                    self.targetAppBundleID = "org.blenderfoundation.blender"
                } else if agent["destinationId"] as? String == "office", let file = agent["targetPath"] as? String,
                          let application = NSWorkspace.shared.urlForApplication(toOpen: URL(fileURLWithPath: file)) {
                    self.targetAppBundleID = Bundle(url: application)?.bundleIdentifier
                } else { self.targetAppBundleID = (agent["focus"] as? [String:Any])?["bundleId"] as? String }
                self.acceptResultFeedback(agent, read: feedbackRead)
            }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: snapshot), let json = String(data: data, encoding: .utf8) else { return }
        let encoded = Data(json.utf8).base64EncodedString()
        let script = "window.TuotieDesktopLive&&TuotieDesktopLive.apply(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('\(encoded)'),c=>c.charCodeAt(0)))))"
        await MainActor.run { overlayWebView.evaluateJavaScript(script, completionHandler: nil) }
    }

    private func hideResultOverlay() {
        resultOverlayWatch?.invalidate(); resultOverlayWatch = nil
        resultOverlay.hide()
        resultFeedback = nil
        resultFeedbackDeadline = .distantPast
    }

    private func invalidateResultGeometry() {
        resultInputRevision += 1
        lastResultInputAt = Date().timeIntervalSince1970 * 1000
        hideResultOverlay()
    }

    private func bindResultWindow() {
        resultWindowBinding = nil
        guard let bundle = targetAppBundleID,
              let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first,
              let (id, _) = resultWindow(bundle) else { return }
        resultWindowBinding = (bundle, app.processIdentifier, id)
    }

    private func acceptResultFeedback(_ agent: [String: Any], read: ResultOverlayReadContext) {
        let feedback = agent["resultFeedback"] as? [String: Any]
        let id = feedback?["id"] as? String ?? ""
        let first = !observedAgentSnapshot
        observedAgentSnapshot = true
        if !first,currentAgentPhase == "done",feedback?["phase"] as? String == "done",feedback?["available"] as? Bool == false,!id.isEmpty,id != resultFeedbackID,
           let capturedAt=feedback?["capturedAt"] as? Double,capturedAt>lastResultInputAt,Date().timeIntervalSince1970*1000-capturedAt<4000 {
            showToast("内容已更新，暂未取得可核验的屏幕范围")
        }
        guard ["preview", "done"].contains(currentAgentPhase), feedback?["phase"] as? String == currentAgentPhase,
              feedback?["available"] as? Bool == true, !id.isEmpty else {
            resultFeedback = nil; resultFeedbackID = id; hideResultOverlay(); return
        }
        guard id != resultFeedbackID else { return }
        resultFeedbackID = id
        // Startup/reconnection snapshots describe old work, never a new cue.
        // Consume stale IDs too, so the following poll cannot revive them.
        guard !first, read.inputRevision == resultInputRevision,
              let capturedAt = feedback?["capturedAt"] as? Double, capturedAt > lastResultInputAt,
              capturedAt <= Date().timeIntervalSince1970 * 1000 + 1000,
              let bundle = targetAppBundleID, read.bundle == bundle,
              let target = resultWindow(bundle), target.0 == read.windowID, target.1 == read.frame else { return }
        resultFeedback = feedback
        resultFeedbackDeadline = Date().addingTimeInterval(4)
        if NSWorkspace.shared.frontmostApplication?.bundleIdentifier != bundle {focusCurrentApplication()}
        presentResultOverlay()
    }

    private func resultWindow(_ bundle: String) -> (CGWindowID, NSRect)? {
        guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first,
              let primary = NSScreen.screens.first,
              let all = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return nil }
        var windows = all.filter { row in
            (row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == app.processIdentifier &&
            (row[kCGWindowLayer as String] as? NSNumber)?.intValue == 0 &&
            (row[kCGWindowIsOnscreen as String] as? Bool ?? false)
        }
        if let binding = resultWindowBinding {
            guard binding.bundle == bundle, binding.pid == app.processIdentifier else { return nil }
            windows = windows.filter { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == binding.id }
        } else if let title = targetWindowTitle, !title.isEmpty {
            windows = windows.filter { $0[kCGWindowName as String] as? String == title }
        }
        // An ambiguous window cannot supply trustworthy result coordinates.
        guard windows.count == 1, let row = windows.first,
              let id = row[kCGWindowNumber as String] as? NSNumber,
              let bounds = row[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary), rect.width > 64, rect.height > 64 else { return nil }
        return (id.uint32Value, NSRect(x: rect.minX, y: primary.frame.maxY - rect.maxY, width: rect.width, height: rect.height))
    }

    private func presentResultOverlay(attempt: Int = 0) {
        guard let feedback = resultFeedback, let id = feedback["id"] as? String,
              id != displayedResultFeedbackID, Date() < resultFeedbackDeadline,
              feedback["phase"] as? String == currentAgentPhase,
              ["window-content-normalized-top-left", "native-result-locators"].contains(feedback["coordinateSpace"] as? String ?? ""),
              let bundle = targetAppBundleID else { return }
        guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier == bundle else {
            if attempt < 4 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { [weak self] in
                    guard self?.resultFeedback?["id"] as? String == id else { return }
                    self?.presentResultOverlay(attempt: attempt + 1)
                }
            }
            return
        }
        guard let (windowID, frame) = resultWindow(bundle) else{return}
        if feedback["coordinateSpace"] as? String == "native-result-locators" {
            guard let receipt=feedback["receipt"] as? [String:Any],
                  let app=NSRunningApplication.runningApplications(withBundleIdentifier:bundle).first else{return}
            resultOverlay.present(id:id,app:app,window:frame,receipt:receipt){[weak self] in
                guard let self else{return false}
                let current=self.resultWindow(bundle)
                return self.resultFeedbackID == id && self.currentAgentPhase == "done" && NSWorkspace.shared.frontmostApplication?.bundleIdentifier == bundle && current?.0 == windowID && current?.1 == frame
            }
            if resultOverlay.currentID == id {displayedResultFeedbackID=id}
            return
        }
        guard let source = feedback["window"] as? [String: Any],
              let width = source["width"] as? Double, let height = source["height"] as? Double,
              let rows = feedback["regions"] as? [[String: Any]], !rows.isEmpty else { return }
        let regions = rows.compactMap { row -> CGRect? in
            guard let x = row["x"] as? Double, let y = row["y"] as? Double,
                  let width = row["width"] as? Double, let height = row["height"] as? Double else { return nil }
            return CGRect(x: x, y: y, width: width, height: height)
        }
        let screen = NSScreen.screens.max { $0.frame.intersection(frame).width * $0.frame.intersection(frame).height < $1.frame.intersection(frame).width * $1.frame.intersection(frame).height }
        guard regions.count == rows.count,
              let mapped = ResultOverlay.normalizeToScreen(regions: regions, windowFrame: frame,
                  sourcePixelSize: CGSize(width: width, height: height), backingScale: screen?.backingScaleFactor ?? 1),
              resultOverlay.show(id: id, screenFrame: frame, regions: mapped, label: currentAgentPhase == "preview" ? "生成预览" : "已生成内容") else { return }
        displayedResultFeedbackID = id
        resultOverlayWatch?.invalidate()
        let expires = Date().addingTimeInterval(2.3)
        resultOverlayWatch = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] timer in
            guard let self else { timer.invalidate(); return }
            let current = self.resultWindow(bundle)
            if Date() >= expires || self.resultFeedbackID != id ||
                self.currentAgentPhase != feedback["phase"] as? String || self.targetAppBundleID != bundle ||
                NSWorkspace.shared.frontmostApplication?.bundleIdentifier != bundle ||
                current?.0 != windowID || current?.1 != frame || NSEvent.pressedMouseButtons != 0 {
                self.hideResultOverlay()
            }
        }
    }

    private func handlePackPointer(_ event: NSEvent) -> NSEvent? {
        guard event.window === overlay else { return event }
        if event.type == .leftMouseDown {
            packGesture += 1
            let p = event.locationInWindow
            let point = CGPoint(x: p.x, y: overlay.frame.height - p.y)
            packArmed = packDragRegions.contains { $0.rect.contains(point) } && !packDragExclusions.contains { $0.rect.contains(point) }
            packStart = packArmed ? overlay.convertPoint(toScreen: p) : nil
            return event
        }
        if event.type == .leftMouseUp {
            packGesture += 1
            if !packDragging { packArmed = false }
            packStart = nil
            return event
        }
        guard packArmed, !packDragging, !packDragPreparing, !officePasteCapturing, let start = packStart,
              hypot(NSEvent.mouseLocation.x - start.x, NSEvent.mouseLocation.y - start.y) >= 8 else { return event }
        packDragPreparing = true
        let gesture = packGesture
        Task { @MainActor in
            defer { self.packDragPreparing = false }
            do {
                let result = try await self.requestJSON(path:"/v1/agent/pack-drag",method:"POST",body:[:])
                guard self.packGesture == gesture, self.packArmed, NSEvent.pressedMouseButtons & 1 != 0 else { return }
                guard result["ok"] as? Bool == true else {
                    self.packArmed = false
                    self.showToast(result["error"] as? String ?? "内容拖放没有就绪，请重试。")
                    return
                }
                self.beginPackDrag(event)
            } catch {
                guard self.packGesture == gesture else { return }
                self.packArmed = false
                self.showToast(error.localizedDescription)
            }
        }
        return event
    }

    private func beginPackDrag(_ event: NSEvent) {
        guard let overlay, let webView = overlayWebView, let prototypeRoot else { return }
        guard !packDragEntries.isEmpty else { return }
        let folder = prototypeRoot.appendingPathComponent(".local", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let id = UUID().uuidString
        let file = folder.appendingPathComponent("pack-\(id).okpaste")
        try? Data("{\"kind\":\"pack\"}\n".utf8).write(to: file)
        let writer = NSPasteboardItem()
        writer.setString(file.absoluteString,forType:.fileURL)
        writer.setString(id,forType:NativePackDrop.type)
        let item = NSDraggingItem(pasteboardWriter: writer)
        // The real file payload and AppKit cancellation stay native. A separate
        // mouse-transparent panel supplies the animated content capsule.
        let size = NSSize(width: 144, height: 44)
        let image = NSImage(size: size, flipped: false) { _ in true }
        let point = overlay.convertPoint(fromScreen: NSEvent.mouseLocation)
        item.setDraggingFrame(NSRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), contents: image)
        packDragging = true
        packArmed = false
        overlay.ignoresMouseEvents = true
        let origin = packStart.map { overlay.convertPoint(fromScreen: $0) } ?? point
        let webPoint = NSPoint(x: origin.x, y: overlay.frame.height - origin.y)
        let source = packDragRegions.first(where: { $0.rect.contains(webPoint) })?.rect
            ?? NSRect(x: webPoint.x - 72, y: webPoint.y - 22, width: 144, height: 44)
        let screenFrame = NSRect(x: overlay.frame.minX + source.minX, y: overlay.frame.maxY - source.maxY, width: source.width, height: source.height)
        packDragSessionID = id
        sendPackMotion("begin", ["sessionId": id, "x": source.minX, "y": source.minY, "width": source.width, "height": source.height])
        packDragVisual.begin(source: screenFrame, entries: packDragEntries, count: packDragEntries.count)
        NSLog("妥帖开始拖内容包")
        let session = webView.beginDraggingSession(with: [item], event: event, source: self)
        packDragSession = session
        session.animatesToStartingPositionsOnCancelOrFail = false
        nativePackDrop.begin(id:id,source:self)
    }

    private func sendPackMotion(_ method: String, _ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        overlayWebView.evaluateJavaScript("window.TuotiePackDrag?.\(method)(\(json))", completionHandler: nil)
    }

    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
        .copy
    }

    func draggingSession(_ session: NSDraggingSession, endedAt screenPoint: NSPoint, operation: NSDragOperation) {
        guard session === packDragSession, let id = packDragSessionID, let overlay else { return }
        packDragSession = nil; packDragSessionID = nil
        packDragging = false
        packArmed = false
        packStart = nil
        NSLog("妥帖拖放结束 %d", operation.rawValue)
        let accepted = !operation.isEmpty
        let nativeDrop = nativePackDrop.finish(id:id,accepted:accepted,at:screenPoint)
        var payload: [String: Any] = ["sessionId": id, "accepted": accepted]
        if accepted {
            let oldFrame = overlay.frame
            if let screen = NSScreen.screens.first(where: { $0.frame.contains(screenPoint) }), overlay.frame != screen.visibleFrame {
                let oldPet = packPetRect?.rect ?? NSRect(x: 30, y: 100, width: 48, height: 48)
                let globalPet = NSRect(x: oldFrame.minX + oldPet.minX, y: oldFrame.maxY - oldPet.maxY, width: oldPet.width, height: oldPet.height)
                overlay.setFrame(screen.visibleFrame, display: true)
                payload["fromX"] = globalPet.minX - overlay.frame.minX
                payload["fromY"] = overlay.frame.maxY - globalPet.maxY
            }
            payload["x"] = screenPoint.x - overlay.frame.minX
            payload["y"] = overlay.frame.maxY - screenPoint.y
        }
        let duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : (accepted ? 0.56 : 0.32)
        packFlightUntil = Date().addingTimeInterval(duration + (accepted && duration > 0 ? 0.34 : 0.1))
        sendPackMotion("end", payload)
        packDragVisual.end(accepted: accepted, at: screenPoint)
        updatePointerRouting()
        if operation.isEmpty {
            // AppKit reports both Escape and an unaccepted drop as .none.
            // Restore the package instead of reporting cancellation as failure.
            return
        }
        if let nativeDrop { captureNativeDrop(nativeDrop);return }
        Task { await self.pushClipboard() }
    }

    private func captureNativeDrop(_ target:NativeDropTarget) {
        guard !officePasteCapturing,overlayLoaded else {showToast("正在读取目标位置，请稍候。");return}
        officePasteCapturing=true
        // Keep our arriving collection out of the one selection click delivered
        // to the real release point. The capsule/result feedback stays non-key.
        overlay.ignoresMouseEvents=true
        Task { @MainActor in
            var capture:InputPasteAnchor?
            let watch=NativeDropWatch()
            defer {watch.close();self.officePasteCapturing=false;self.updatePointerRouting()}
            do {
                let proof=try await target.position()
                guard !watch.changed,target.valid() else {throw InputPasteFailure("落点窗口已变化，请重新拖入。")}
                var context=self.foregroundContext(target.app)
                context["nativeDrop"]=proof
                if target.host=="input" {
                    let input=try InputPasteAnchor(app:target.app,manualOnly:proof["positioned"] as? Bool != true)
                    capture=input
                    await input.prepare()
                    var focus=input.context();focus["nativeDrop"]=proof
                    context=["id":input.id,"focus":focus,"manual":input.manual]
                    if let screenshot=target.screenshot(){context["screenshot"]=screenshot}
                    else {focus["visualContextUnavailable"]="没有取得本次目标窗口截图，请仅使用实际可读文字，不推测界面内容。";context["focus"]=focus}
                }
                guard !watch.changed,target.valid(),target.app.isActive else {throw InputPasteFailure("捕获期间目标已变化，请重新拖入。")}
                let result=try await self.requestJSON(path:"/v1/agent/\(target.host)-paste",method:"POST",body:context)
                guard result["ok"] as? Bool == true else {throw ClipboardWorkError(result["error"] as? String ?? "落点没有保存。")}
                guard !watch.changed,target.valid(),target.app.isActive else {throw InputPasteFailure("读取期间发生了新操作，已释放本次落点；请重新拖入。")}
                self.inputAnchor?.release();self.inputAnchor=capture
                await self.pushClipboard()
                let point=self.overlay.convertPoint(fromScreen:target.point)
                let position:[String:Any]=["x":point.x+10,"y":self.overlay.frame.height-point.y+8,"exact":true]
                let data=try JSONSerialization.data(withJSONObject:position)
                self.overlay.ignoresMouseEvents=false
                self.overlay.makeKeyAndOrderFront(nil)
                self.callLive("openOfficePaste(\(String(data:data,encoding:.utf8)!), '\(target.host)')")
            }catch{
                capture?.release()
                _ = try? await self.requestJSON(path:"/v1/agent/pack-drop-cancel",method:"POST",body:["id":target.sessionID])
                self.showToast(error.localizedDescription)
            }
        }
    }

    private func performWork(destinationId: String, sourceIds: [String], bundleIds: [String], actionIndex: Int, instruction: String, dropEventId: String, continuation: Bool) {
        guard !working else { return }
        workRevision += 1
        let revision = workRevision
        working = true
        Task {
            defer { if workRevision == revision { working = false } }
            if sourceIds.isEmpty && !(currentTargetKind=="input-live" && destinationId=="focused" && !instruction.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty) {
                finishWork("这些还不是已保存的内容。先选中参考文字、图片或视频，再点「加入内容包」。", stop: true, revision: revision)
                return
            }
            if ["blender","office","focused","jianying"].contains(destinationId) {
                do { finishWork(try await runAgent(destinationId: destinationId, sourceIds: sourceIds, actionIndex: actionIndex, instruction: instruction, dropEventId: dropEventId, continuation: continuation, revision: revision), stop: false, revision: revision) }
                catch { finishWork(error.localizedDescription, stop: true, revision: revision) }
                return
            }
            var lines: [String] = []
            var failed = 0
            for id in sourceIds {
                do { lines.append(try await pasteItem(id: id, destinationId: destinationId)) }
                catch {
                    failed += 1
                    lines.append(error.localizedDescription)
                }
            }
            if failed == 0 && destinationId == "system" {
                do { _ = try await requestJSON(path: "/v1/clipboard/archive", method: "POST", body: ["itemIds": bundleIds]); await pushClipboard() }
                catch { lines.append("已复制，但内容包归档失败：\(error.localizedDescription)") }
            }
            finishWork(lines.joined(separator: "\n"), stop: failed == sourceIds.count, revision: revision)
        }
    }

    private func runAgent(destinationId: String, sourceIds: [String], actionIndex: Int, instruction: String, dropEventId: String, continuation: Bool, revision: Int) async throws -> String {
        if destinationId == "blender" { await MainActor.run { self.focusBlender() } }
        var body: [String: Any] = ["destinationId": destinationId, "actionIndex": actionIndex, "instruction": instruction, "itemIds": sourceIds, "continuation": continuation]
        if !dropEventId.isEmpty { body["dropEventId"] = dropEventId }
        let started = try await requestJSON(path: "/v1/agent/run", method: "POST", body: body)
        if let error = started["error"] as? String { throw ClipboardWorkError(error) }
        let deadline = Date().addingTimeInterval(480)
        while Date() < deadline {
            try await Task.sleep(nanoseconds: 500_000_000)
            guard workRevision == revision else { throw CancellationError() }
            let status = try await requestJSON(path: "/v1/agent/status", method: "GET", body: nil)
            let phase = status["phase"] as? String ?? ""
            if phase == "idle" { throw ClipboardWorkError("任务已结束，请重新选择位置") }
            if phase == "preview" || phase == "done" {
                if destinationId == "office", !["word-live", "excel-live"].contains(status["targetKind"] as? String ?? ""), phase == "preview", let filename = status["previewPath"] as? String {
                    _ = await MainActor.run { NSWorkspace.shared.open(URL(fileURLWithPath: filename)) }
                }
                let summary = (status["result"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                return summary.isEmpty ? "预览已就绪，请检查后应用" : summary
            }
            if phase == "ready" {
                throw ClipboardWorkError((status["summary"] as? String) ?? "补充一下你的要求")
            }
            if phase == "error" {
                throw ClipboardWorkError((status["error"] as? String) ?? "场景操作失败")
            }
        }
        throw ClipboardWorkError("场景操作超时")
    }

    private func focusBlender() {
        if let running = NSRunningApplication.runningApplications(withBundleIdentifier: "org.blenderfoundation.blender").first(where: { !$0.isTerminated }) {
            running.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
            return
        }
        let installed = URL(fileURLWithPath: "/Applications/Blender.app")
        guard let app = FileManager.default.fileExists(atPath: installed.path) ? installed : NSWorkspace.shared.urlForApplication(withBundleIdentifier: "org.blenderfoundation.blender") else { return }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.openApplication(at: app, configuration: configuration)
    }

    private func openAgentFile(preview: Bool) {
        Task {
            do {
                let status = try await requestJSON(path: "/v1/agent/status", method: "GET", body: nil)
                guard let filename = status[preview ? "previewPath" : "targetPath"] as? String, !filename.isEmpty else {
                    showToast(preview ? "还没有可打开的预览" : "请先选择目标文件")
                    return
                }
                _ = await MainActor.run { NSWorkspace.shared.open(URL(fileURLWithPath: filename)) }
            } catch { showToast(error.localizedDescription) }
        }
    }

    private func writeDirectionButtons(_ buttons: [Any]) {
        writeScreenPoints(buttons, named: "direction-buttons.json")
    }

    private func writeDropButtons(_ buttons: [Any]) {
        writeScreenPoints(buttons, named: "drop-buttons.json")
    }

    private func writeBundle(_ value: Any?) {
        writeNamedRect(value, named: "bundle-rect.json")
    }

    private func writeNamedRect(_ value: Any?, named name: String) {
        guard let rect = value as? [String: Any] else {
            if let prototypeRoot {
                try? FileManager.default.removeItem(at: prototypeRoot.appendingPathComponent(".local").appendingPathComponent(name))
            }
            return
        }
        writeScreenPoints([rect], named: name)
    }

    private func writeScreenPoints(_ buttons: [Any], named name: String) {
        guard let prototypeRoot, let overlay else { return }
        let screenHeight = NSScreen.screens.map(\.frame.maxY).max() ?? 0
        let mapped: [[String: Any]] = buttons.compactMap { value in
            guard let data = value as? [String: Any],
                  let x = (data["x"] as? NSNumber)?.doubleValue,
                  let y = (data["y"] as? NSNumber)?.doubleValue,
                  let width = (data["width"] as? NSNumber)?.doubleValue,
                  let height = (data["height"] as? NSNumber)?.doubleValue else { return nil }
            let cocoaX = overlay.frame.minX + x + width / 2
            let cocoaY = overlay.frame.maxY - (y + height / 2)
            return [
                "index": (data["index"] as? NSNumber)?.intValue ?? 0,
                "action": data["action"] as? String ?? "",
                "text": data["text"] as? String ?? "",
                "x": cocoaX,
                "y": screenHeight - cocoaY,
                "width": width,
                "height": height,
            ]
        }
        let file = prototypeRoot.appendingPathComponent(".local").appendingPathComponent(name)
        guard let data = try? JSONSerialization.data(withJSONObject: mapped, options: [.prettyPrinted]) else { return }
        try? data.write(to: file)
    }

    private func pasteItem(id: String, destinationId: String) async throws -> String {
        let listed = try await requestJSON(path: "/v1/clipboard/items/\(id)", method: "GET", body: nil)
        if let error = listed["error"] as? String { throw ClipboardWorkError(error) }
        let item = listed["item"] as? [String: Any] ?? [:]
        let pasted = try await requestJSON(path: "/v1/clipboard/paste", method: "POST", body: ["itemId": id, "destinationId": destinationId] as [String: Any])
        if let error = pasted["error"] as? String { throw ClipboardWorkError(error) }
        let body = item["body"] as? [String: Any] ?? [:]
        let source = item["source"] as? [String: Any] ?? [:]
        let text = (body["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let title = (source["title"] as? String) ?? (text.isEmpty ? (item["type"] as? String ?? "内容") : String(text.prefix(32)))
        return "已贴到\(destinationLabel(destinationId))：\(title)"
    }

    private func destinationLabel(_ id: String) -> String {
        switch id {
        case "system", "document": return "系统剪贴板"
        case "hold": return "妥帖"
        case "blender": return "Blender"
        default: return id
        }
    }

    private func showToast(_ text: String) {
        let encoded = Data(text.utf8).base64EncodedString()
        let script = """
        (() => {
          const text = new TextDecoder().decode(Uint8Array.from(atob('\(encoded)'), c => c.charCodeAt(0)));
          if (typeof showToast === 'function') showToast(text);
        })()
        """
        DispatchQueue.main.async { [weak self] in
            self?.overlayWebView.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    private func finishWork(_ text: String, stop: Bool, revision: Int) {
        let encoded = Data(text.utf8).base64EncodedString()
        let script = """
        (() => {
          const text = new TextDecoder().decode(Uint8Array.from(atob('\(encoded)'), c => c.charCodeAt(0)));
          const state = window.TuotieUI?.getState();
          if (state?.phase === 'generating') {
            if (\(stop ? "true" : "false")) window.TuotieUI.dispatch({type:'generation/stop'});
            else window.TuotieUI.dispatch({type:'generation/finish', text});
          }
          if (typeof showToast === 'function') showToast(text);
        })()
        """
        DispatchQueue.main.async { [weak self] in
            guard self?.workRevision == revision else { return }
            self?.overlayWebView.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    private func fetchJSON(path: String) async -> [String: Any]? {
        try? await requestJSON(path: path, method: "GET", body: nil)
    }

    private func requestJSON(path: String, method: String, body: [String: Any]?) async throws -> [String: Any] {
        guard let url = URL(string: "http://127.0.0.1:\(clipboardPort)\(path)") else { throw ClipboardWorkError("剪贴板地址无效") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = ["/v1/agent/target", "/v1/agent/blender-paste", "/v1/agent/word-paste", "/v1/agent/excel-paste", "/v1/agent/powerpoint-paste", "/v1/agent/illustrator-paste", "/v1/agent/figma-paste", "/v1/agent/control"].contains(path) ? 40 : 8
        if ["/v1/agent/blender-paste", "/v1/agent/word-paste", "/v1/agent/excel-paste", "/v1/agent/powerpoint-paste", "/v1/agent/illustrator-paste", "/v1/agent/figma-paste"].contains(path) { request.setValue("office-paste", forHTTPHeaderField:"X-Tuotie-Native") }
        if ["/v1/agent/input-paste","/v1/agent/input-exchange"].contains(path) {request.setValue("input-paste",forHTTPHeaderField:"X-Tuotie-Native")}
        if ["/v1/agent/pack-drag","/v1/agent/pack-drop-cancel"].contains(path) {request.setValue("pack-drag",forHTTPHeaderField:"X-Tuotie-Native")}
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body, options: .sortedKeys)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let payload = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if status >= 400, payload["error"] == nil { throw ClipboardWorkError("剪贴板没有响应") }
        return payload
    }

    private func jsString(_ value: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [value])
        let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return String(text.dropFirst().dropLast())
    }

    private func shellQuote(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}

private struct ClipboardWorkError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

let application = NSApplication.shared
let delegate = DesktopPreviewApp()
application.delegate = delegate
application.run()
