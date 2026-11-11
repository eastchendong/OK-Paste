import AppKit
import ApplicationServices

struct TextSelection {
    let text: String
    let source: [String: Any]
    let pid: pid_t
    let bounds: CGRect?
    let pointer: NSPoint
    let role: String
    let range: CFRange?

    var anchorContext: [String: Any] {
        var context: [String: Any] = ["appName": source["appName"] ?? "当前应用", "bundleId": source["bundleId"] ?? "", "windowTitle": source["title"] ?? "", "role": role, "selectedText": String(text.prefix(8000)), "accessibility": true]
        var anchor: [String: Any] = ["markedAt": ISO8601DateFormatter().string(from: Date())]
        if let url = source["url"] as? String {
            anchor["url"] = url
            if let document = URL(string: url), document.isFileURL { context["documentPath"] = document.path }
        }
        if let range { anchor["range"] = ["location": range.location, "length": range.length] }
        if let bounds { anchor["bounds"] = ["x": bounds.minX, "y": bounds.minY, "width": bounds.width, "height": bounds.height] }
        context["editAnchor"] = anchor
        return context
    }
}

private final class SelectionPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// A native selection toolbar. It never reads the pasteboard or synthesizes Copy.
final class SelectionCopy: NSObject {
    private let onAction: (String, TextSelection, @escaping (Bool) -> Void) -> Void
    private let queue = DispatchQueue(label: "cn.tuotie.selection", qos: .userInitiated)
    private var monitors: [Any] = []
    private var activation: NSObjectProtocol?
    private var observer: AXObserver?
    private var observedPID: pid_t = 0
    private var observedElement: AXUIElement?
    private var pending: DispatchWorkItem?
    private var revision = 0
    private var panel: SelectionPanel?
    private var button: NSButton?
    private var anchorButton: NSButton?
    private var selection: TextSelection?
    private var copying = false

    init(onAction: @escaping (String, TextSelection, @escaping (Bool) -> Void) -> Void) {
        self.onAction = onAction
        super.init()
    }

    func start() {
        // Preflight only: never bring up a permission dialog on selection/startup.
        if let monitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .leftMouseUp, .keyUp, .scrollWheel], handler: { [weak self] event in
            guard let self else { return }
            if event.type == .leftMouseDown || event.type == .scrollWheel { self.hide(); return }
            if event.type == .keyUp {
                let extendsSelection = event.modifierFlags.contains(.shift) && [123,124,125,126].contains(Int(event.keyCode))
                let selectsAll = event.keyCode == 0 && event.modifierFlags.contains(.command)
                if !extendsSelection && !selectsAll { self.hide(); return }
            }
            self.schedule()
        }) { monitors.append(monitor) }
        if let monitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .keyDown], handler: { [weak self] event in
            guard let self else { return event }
            if event.window !== self.panel { self.hide() }
            return event
        }) { monitors.append(monitor) }
        activation = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { [weak self] _ in
            self?.hide(); self?.bindObserver()
        }
        bindObserver()
    }

    func stop() {
        hide(); monitors.forEach { NSEvent.removeMonitor($0) }; monitors = []
        if let activation { NSWorkspace.shared.notificationCenter.removeObserver(activation) }
        unbindObserver()
    }

    func revealSelection() { bindObserver(); schedule() }
    func copySelectionNow() { bindObserver(); schedule(copyImmediately: true) }

    private func unbindObserver() {
        if let observer { CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .commonModes) }
        observer = nil; observedElement = nil; observedPID = 0
    }

    private func bindObserver() {
        guard AXIsProcessTrusted(), let app = NSWorkspace.shared.frontmostApplication,
              app.bundleIdentifier != Bundle.main.bundleIdentifier else { unbindObserver(); return }
        if observedPID == app.processIdentifier { return }
        unbindObserver()
        let application = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(application, 0.2)
        // Chromium exposes its web accessibility tree when an assistive client connects.
        if ["com.google.Chrome", "com.microsoft.edgemac", "company.thebrowser.Browser"].contains(app.bundleIdentifier ?? "") {
            AXUIElementSetAttributeValue(application, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        }
        var created: AXObserver?
        let result = AXObserverCreate(app.processIdentifier, { _, _, _, context in
            guard let context else { return }
            Unmanaged<SelectionCopy>.fromOpaque(context).takeUnretainedValue().schedule()
        }, &created)
        guard result == .success, let created else { return }
        observer = created; observedPID = app.processIdentifier
        let context = Unmanaged.passUnretained(self).toOpaque()
        AXObserverAddNotification(created, application, kAXFocusedUIElementChangedNotification as CFString, context)
        AXObserverAddNotification(created, application, kAXSelectedTextChangedNotification as CFString, context)
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(created), .commonModes)
        observeFocusedElement(application)
    }

    private func observeFocusedElement(_ application: AXUIElement) {
        guard let observer else { return }
        if let observedElement { AXObserverRemoveNotification(observer, observedElement, kAXSelectedTextChangedNotification as CFString) }
        observedElement = Self.element(application, kAXFocusedUIElementAttribute as CFString)
        if let observedElement { AXObserverAddNotification(observer, observedElement, kAXSelectedTextChangedNotification as CFString, Unmanaged.passUnretained(self).toOpaque()) }
    }

    private func schedule(copyImmediately: Bool = false) {
        guard !copying else { return }
        pending?.cancel(); revision += 1
        let token = revision
        let work = DispatchWorkItem { [weak self] in
            guard let self, token == self.revision, AXIsProcessTrusted(), NSEvent.pressedMouseButtons == 0,
                  let app = NSWorkspace.shared.frontmostApplication, app.bundleIdentifier != Bundle.main.bundleIdentifier else { return }
            self.bindObserver()
            let application = AXUIElementCreateApplication(app.processIdentifier)
            self.observeFocusedElement(application)
            let pointer = NSEvent.mouseLocation
            self.queue.async {
                let found = Self.read(app, pointer: pointer)
                DispatchQueue.main.async {
                    guard token == self.revision, !self.copying,
                          NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else { return }
                    if let found { self.show(found); if copyImmediately { self.perform("copy") } } else { self.hide() }
                }
            }
        }
        pending = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.16, execute: work)
    }

    private static func value(_ element: AXUIElement, _ attribute: CFString) -> CFTypeRef? {
        var result: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, attribute, &result) == .success ? result : nil
    }
    private static func element(_ parent: AXUIElement, _ attribute: CFString) -> AXUIElement? {
        guard let result = value(parent, attribute), CFGetTypeID(result) == AXUIElementGetTypeID() else { return nil }
        return (result as! AXUIElement)
    }
    private static func parameter(_ element: AXUIElement, _ name: String, _ argument: CFTypeRef) -> CFTypeRef? {
        var result: CFTypeRef?
        return AXUIElementCopyParameterizedAttributeValue(element, name as CFString, argument, &result) == .success ? result : nil
    }
    private static func rect(_ value: CFTypeRef?) -> CGRect? {
        guard let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        let ax = value as! AXValue
        guard AXValueGetType(ax) == .cgRect else { return nil }
        var result = CGRect.zero
        return AXValueGetValue(ax, .cgRect, &result) && result.width >= 0 && result.height >= 0 && (result.width > 0 || result.height > 0) ? result : nil
    }

    private static func read(_ app: NSRunningApplication, pointer: NSPoint) -> TextSelection? {
        let application = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(application, 0.2)
        guard let focused = element(application, kAXFocusedUIElementAttribute as CFString) else { return nil }
        var candidates: [AXUIElement] = []
        var ancestor: AXUIElement? = focused
        for _ in 0..<9 {
            guard let current = ancestor else { break }
            let role = value(current, kAXRoleAttribute as CFString) as? String ?? ""
            let subrole = value(current, kAXSubroleAttribute as CFString) as? String ?? ""
            if role == "AXSecureTextField" || subrole == "AXSecureTextField" { return nil }
            candidates.append(current)
            ancestor = element(current, kAXParentAttribute as CFString)
        }
        let window = element(application, kAXFocusedWindowAttribute as CFString)
        var source: [String: Any] = ["appName": app.localizedName ?? "当前应用", "bundleId": app.bundleIdentifier ?? "", "captureMethod": "accessibility-selection"]
        if let window {
            if let title = value(window, kAXTitleAttribute as CFString) as? String { source["title"] = title }
            if let document = value(window, kAXDocumentAttribute as CFString) as? String,
               let url = URL(string: document), ["http", "https", "file"].contains(url.scheme ?? "") { source["url"] = document }
        }
        for candidate in candidates {
            var text = value(candidate, kAXSelectedTextAttribute as CFString) as? String
            var bounds: CGRect?
            var selectedRange: CFRange?
            let role = value(candidate, kAXRoleAttribute as CFString) as? String ?? ""
            if let range = value(candidate, kAXSelectedTextRangeAttribute as CFString) {
                bounds = rect(parameter(candidate, kAXBoundsForRangeParameterizedAttribute, range))
                if CFGetTypeID(range) == AXValueGetTypeID() {
                    let ax = range as! AXValue
                    var result = CFRange()
                    if AXValueGetType(ax) == .cfRange, AXValueGetValue(ax, .cfRange, &result) { selectedRange = result }
                }
            }
            // WebKit/Chromium text markers cover selections spanning several DOM nodes.
            if let marker = value(candidate, "AXSelectedTextMarkerRange" as CFString) {
                if text?.isEmpty != false { text = parameter(candidate, "AXStringForTextMarkerRange", marker) as? String }
                if bounds == nil { bounds = rect(parameter(candidate, "AXBoundsForTextMarkerRange", marker)) }
            }
            let selected = text ?? ""
            let hasText = !selected.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            // Empty carets only belong to the optional target-position action.
            let caret = ["AXTextArea", "AXTextField"].contains(role) && selectedRange?.length == 0
            if caret, candidates.contains(where: { value($0, kAXRoleAttribute as CFString) as? String == "AXComboBox" }) { continue }
            guard (hasText || ComponentLibrary.selectionAnchorEnabled && caret), selected.utf8.count <= 200_000 else { continue }
            if source["url"] == nil {
                for parent in candidates {
                    let raw = value(parent, kAXURLAttribute as CFString)
                    let url = (raw as? URL) ?? (raw as? String).flatMap { URL(string: $0) }
                    if let url, ["http", "https"].contains(url.scheme ?? "") { source["url"] = url.absoluteString; break }
                }
            }
            return TextSelection(text: selected, source: source, pid: app.processIdentifier, bounds: bounds, pointer: pointer, role: role, range: selectedRange)
        }
        return nil
    }

    private func show(_ found: TextSelection) {
        if selection?.text == found.text, selection?.pid == found.pid, selection?.range?.location == found.range?.location, selection?.bounds == found.bounds, panel?.isVisible == true { return }
        selection = found
        if panel == nil {
            let panel = SelectionPanel(contentRect: CGRect(origin: .zero, size: ComponentLibrary.selectionSize), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            panel.title = "妥帖 · 选区操作"; panel.level = .popUpMenu
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = true; panel.hidesOnDeactivate = false
            let content = SelectionToolbarView(iconURL: Bundle.main.resourceURL!.appendingPathComponent("StatusIcon.png"), target: self, copyAction: #selector(copySelection), anchorAction: #selector(startHere))
            panel.contentView = content
            self.panel = panel; self.button = content.copyButton; self.anchorButton = content.anchorButton
        }
        guard let panel else { return }
        button?.title = ComponentLibrary.copyLabel; button?.isEnabled = !found.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        anchorButton?.title = ComponentLibrary.anchorLabel; anchorButton?.isEnabled = true
        let primaryTop = NSScreen.screens.first?.frame.maxY ?? 0
        let anchor = found.bounds.map { CGRect(x: $0.minX, y: primaryTop - $0.maxY, width: $0.width, height: $0.height) }
        let frame = SelectionToolbarPlacement.frame(selection: anchor, pointer: found.pointer, size: panel.frame.size, visibleFrames: NSScreen.screens.map(\.visibleFrame))
        panel.setFrameOrigin(frame.origin); panel.orderFrontRegardless()
    }

    private func hide() {
        pending?.cancel(); revision += 1
        if copying { return }
        panel?.orderOut(nil); selection = nil
    }

    @objc private func copySelection() { perform("copy") }
    @objc private func startHere() { perform("anchor") }
    private func perform(_ action: String) {
        guard let selection, !copying,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == selection.pid else { hide(); return }
        if action == "copy" && selection.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return }
        copying = true; button?.isEnabled = false; anchorButton?.isEnabled = false
        let active = action == "copy" ? button : anchorButton
        active?.title = "…"
        onAction(action, selection) { [weak self] success in
            DispatchQueue.main.async {
                guard let self else { return }
                self.copying = false
                active?.title = success ? (action == "copy" ? "已复制" : "已标记位置") : "重试"
                self.button?.isEnabled = !success && !selection.text.isEmpty; self.anchorButton?.isEnabled = !success
                if success { DispatchQueue.main.asyncAfter(deadline: .now() + 0.65) { self.hide() } }
            }
        }
    }
}
