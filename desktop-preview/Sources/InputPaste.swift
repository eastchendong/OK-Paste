import AppKit
import ApplicationServices
import Carbon

private func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
private func child(_ element: AXUIElement, _ name: String) -> AXUIElement? {
    guard let value = attribute(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}
private func writable(_ element: AXUIElement, _ name: String) -> Bool {
    var settable = DarwinBoolean(false)
    return AXUIElementIsAttributeSettable(element, name as CFString, &settable) == .success && settable.boolValue
}
private func selectedRange(_ element: AXUIElement) -> NSRange? {
    guard let value = attribute(element, kAXSelectedTextRangeAttribute), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    var range = CFRange()
    guard AXValueGetValue(value as! AXValue, .cfRange, &range), range.location >= 0, range.length >= 0 else { return nil }
    return NSRange(location: range.location, length: range.length)
}
private func fieldText(_ element: AXUIElement) -> String? {
    if let value = attribute(element, kAXValueAttribute) as? String { return value }
    return (attribute(element, kAXNumberOfCharactersAttribute) as? NSNumber)?.intValue == 0 ? "" : nil
}
private func protectedField(_ element: AXUIElement) -> Bool {
    [kAXRoleAttribute, kAXSubroleAttribute].contains { attribute(element, $0) as? String == "AXSecureTextField" }
        || (attribute(element, "AXProtectedContent") as? Bool) == true
}
private func sameElement(_ lhs: AXUIElement?, _ rhs: AXUIElement?) -> Bool {
    guard let lhs, let rhs else { return false }
    return CFEqual(lhs, rhs)
}

struct InputPasteFailure: LocalizedError {
    let message: String
    let mutationStarted: Bool
    init(_ message: String, started: Bool = false) { self.message = message; mutationStarted = started }
    var errorDescription: String? { message }
}

/// A task owns just the selected UTF-16 range. A newer draft must never be overwritten.
struct InputDraft {
    private(set) var value: String
    private(set) var range: NSRange
    let originalSelection: String
    init?(value: String, range: NSRange) {
        let length = (value as NSString).length
        guard range.location >= 0, range.location <= length, range.length >= 0, range.length <= length-range.location else { return nil }
        self.value = value; self.range = range
        originalSelection = (value as NSString).substring(with: range)
    }
    func replacing(in current: String?, with replacement: String) throws -> String {
        guard current?.utf16.elementsEqual(value.utf16) == true else {
            throw InputPasteFailure("原输入框的草稿已变动。请结束本次任务，重新选中要改的文字。")
        }
        return (value as NSString).replacingCharacters(in: range, with: replacement)
    }
    mutating func confirm(_ newValue: String, replacement: String) {
        value = newValue; range.length = (replacement as NSString).length
    }
}


/// Clipboard changes are temporary. Leave a newer user copy alone.
@MainActor private final class InputPasteboard {
    private let board=NSPasteboard.general
    private var saved:[NSPasteboardItem]=[]
    private var owned:Int?
    init() throws {
        let count=board.changeCount
        for item in board.pasteboardItems ?? [] {
            let copy=NSPasteboardItem()
            for type in item.types {
                guard let data=item.data(forType:type),copy.setData(data,forType:type) else {throw InputPasteFailure("无法暂存当前剪贴板。")}
            }
            saved.append(copy)
        }
        guard board.changeCount==count else {throw InputPasteFailure("剪贴板已变动，请重试。")}
        owned=count
    }
    func put(_ text:String) throws {
        guard owned==board.changeCount else {throw InputPasteFailure("剪贴板已被修改，请重试。")}
        board.clearContents();owned=board.changeCount
        guard board.setString(text,forType:.string) else {throw InputPasteFailure("系统剪贴板无法写入。")}
        owned=board.changeCount
    }
    func copySelection(pid:pid_t,matching expected:String?=nil) async throws -> String? {
        try put(UUID().uuidString)
        let before=board.changeCount
        try inputKey(8,.maskCommand,pid)
        for _ in 0..<18 {
            try await Task.sleep(nanoseconds:22_000_000)
            if board.changeCount != before {
                guard let text=board.string(forType:.string) else {throw InputPasteFailure("当前选区没有提供纯文字。")}
                // An unexpected copy could belong to the user; don't overwrite it when restoring.
                if expected == nil || text==expected {owned=board.changeCount}
                return text
            }
        }
        return nil
    }
    func restore() {
        if let owned,owned==board.changeCount { board.clearContents();if !saved.isEmpty {_ = board.writeObjects(saved)} }
        owned=nil
    }
}
private let inputEventTag:Int64=0x5455494e
private func inputKey(_ key:CGKeyCode,_ flags:CGEventFlags,_ pid:pid_t) throws {
    let source=CGEventSource(stateID:.privateState)
    guard let down=CGEvent(keyboardEventSource:source,virtualKey:key,keyDown:true),
          let up=CGEvent(keyboardEventSource:source,virtualKey:key,keyDown:false) else {throw InputPasteFailure("系统无法编辑当前输入框。")}
    for event in [down,up] {
        event.flags=flags;event.setIntegerValueField(.eventSourceUserData,value:inputEventTag);event.postToPid(pid)
    }
}
private func hasPasteCommand(_ application:AXUIElement) -> Bool {
    guard let bar=child(application,kAXMenuBarAttribute),let menus=attribute(bar,kAXChildrenAttribute) as? [AXUIElement] else {return false}
    for item in menus {
        guard let opened=attribute(item,kAXChildrenAttribute) as? [AXUIElement],let menu=opened.first,
              let actions=attribute(menu,kAXChildrenAttribute) as? [AXUIElement] else {continue}
        func matches(_ action:AXUIElement, _ key:String, _ names:[String]) -> Bool {
            (attribute(action,kAXMenuItemCmdCharAttribute) as? String)?.lowercased()==key ||
                names.contains(attribute(action,kAXTitleAttribute) as? String ?? "")
        }
        let paste=actions.contains { matches($0,"v",["粘贴","粘貼","貼上","Paste"]) && attribute($0,kAXEnabledAttribute) as? Bool != false }
        let copy=actions.contains {matches($0,"c",["复制","複製","Copy"])}
        if paste && copy {return true}
    }
    return false
}

/// Custom editors (e.g. Qt) can expose only a window. Verify the exact selected
/// fragment with Copy before each replacement and after Paste. Never select all.
@MainActor private final class KeyboardInputDraft {
    let pid:pid_t
    var original:String=""
    private var current:String?
    init(pid:pid_t){self.pid=pid}
    func capture() async throws {
        let board=try InputPasteboard();defer{board.restore()}
        let selected=try await board.copySelection(pid:pid) ?? ""
        guard selected.count<=1200 else {throw InputPasteFailure("选区过长，此控件请使用手动粘贴。")}
        original=selected
    }
    private func selectPrevious(_ count:Int) async throws {
        for index in 0..<count {
            try inputKey(123,.maskShift,pid)
            if index % 24 == 23 {try await Task.sleep(nanoseconds:8_000_000)}
        }
        try await Task.sleep(nanoseconds:45_000_000)
    }
    func replace(with replacement:String,restoreOriginal:Bool,check:() throws -> Void) async throws {
        let next=restoreOriginal ? original : replacement
        guard next.count<=1200, !next.contains(where:{$0.isNewline}), !next.contains("\t") else {
            throw InputPasteFailure("此控件只能可靠核对短单行草稿。请点“复制生成文字”后手动粘贴。")
        }
        let board=try InputPasteboard();defer{board.restore()}
        try check()
        if let current {
            try await selectPrevious(current.count)
            try check()
            let found=try await board.copySelection(pid:pid,matching:current)
            guard found==current else {throw InputPasteFailure("原输入位置或草稿已经变化，未替换文字。请重新选中要改的内容。")}
        } else {
            let selection=try await board.copySelection(pid:pid,matching:original)
            guard (selection ?? "")==original else {throw InputPasteFailure("输入框选区已经变化，请重新选择。")}
        }
        try check()
        if !next.isEmpty {try board.put(next);try inputKey(9,.maskCommand,pid)}
        else if !(current ?? original).isEmpty {try inputKey(51,[],pid)}
        // Read back the affected selection before acknowledging a version.
        do {
            try await Task.sleep(nanoseconds:100_000_000)
            try check()
            if !next.isEmpty {
                try await selectPrevious(next.count)
                try check()
                let actual=try await board.copySelection(pid:pid,matching:next)
                guard actual==next else {throw InputPasteFailure("无法回读刚粘贴的草稿。请检查输入框，勿重复粘贴。",started:true)}
                try inputKey(124,[],pid)
            } else {
                let previous=current ?? original
                if !previous.isEmpty {
                    try await selectPrevious(previous.count);try check()
                    let remaining=try await board.copySelection(pid:pid)
                    if remaining != nil {try inputKey(124,[],pid)}
                    guard remaining != previous else {throw InputPasteFailure("旧草稿仍可读回，删除未确认，请检查输入框。",started:true)}
                }
            }
            current=next
        } catch {throw InputPasteFailure(error.localizedDescription,started:true)}
    }
}

@MainActor final class InputPasteAnchor {
    let id = UUID().uuidString
    let app: NSRunningApplication
    private let application: AXUIElement
    private let window: AXUIElement?
    private let field: AXUIElement?
    private let title: String?
    private let document: String?
    private var draft: InputDraft?
    private var keyboard: KeyboardInputDraft?
    private var version = 0
    private var navigationMonitor: Any?
    private var navigated = false
    var polling = false
    var receipt: [String: Any]?
    var manual: Bool { draft == nil && keyboard == nil }
    var keyboardVerified:Bool {keyboard != nil}

    static func isSearchField(in app: NSRunningApplication) -> Bool {
        guard AXIsProcessTrusted(), let field = child(AXUIElementCreateApplication(app.processIdentifier), kAXFocusedUIElementAttribute) else { return false }
        return attribute(field, kAXSubroleAttribute) as? String == "AXSearchField"
    }

    init(app: NSRunningApplication, manualOnly: Bool = false) throws {
        self.app = app; application = AXUIElementCreateApplication(app.processIdentifier)
        guard !IsSecureEventInputEnabled() else { throw InputPasteFailure("当前是受保护的输入位置。") }
        AXUIElementSetMessagingTimeout(application, 0.4)
        var focused = AXIsProcessTrusted() ? child(application,kAXFocusedUIElementAttribute) : nil
        if AXIsProcessTrusted(), focused == nil || ["AXWindow","AXWebArea","AXGroup"].contains(focused.flatMap { attribute($0,kAXRoleAttribute) as? String } ?? "") {
            // Electron and other Chromium hosts may lazily expose their editable accessibility tree.
            AXUIElementSetAttributeValue(application,"AXManualAccessibility" as CFString,kCFBooleanTrue)
            focused = child(application,kAXFocusedUIElementAttribute)
        }
        if let focused, protectedField(focused) { throw InputPasteFailure("密码输入框不支持 AI 粘贴。") }
        window = AXIsProcessTrusted() ? child(application,kAXFocusedWindowAttribute) : nil
        title = window.flatMap { attribute($0,kAXTitleAttribute) as? String }
        document = window.flatMap { attribute($0,kAXDocumentAttribute) as? String }
        field = focused
        if !manualOnly, let focused, let window, sameElement(child(focused,kAXWindowAttribute) ?? window,window) {
            let role = attribute(focused,kAXRoleAttribute) as? String ?? ""
            let editable = attribute(focused,"AXEditable") as? Bool == true || writable(focused,kAXSelectedTextAttribute) || writable(focused,kAXValueAttribute)
            let textRole = ["AXTextField","AXTextArea","AXComboBox"].contains(role) || attribute(focused,"AXEditable") as? Bool == true
            if textRole, editable, attribute(focused,kAXEnabledAttribute) as? Bool != false,
               attribute(focused,"AXReadOnly") as? Bool != true, let value=fieldText(focused),
               value.utf16.count <= 250000, let range=selectedRange(focused) {
                draft = InputDraft(value:value,range:range)
            }
            if ["AXButton","AXLink","AXMenuItem","AXCheckBox"].contains(role) { throw InputPasteFailure("请先点击可以打字的输入框，再使用 AI 粘贴。") }
        }
        if !manualOnly, draft==nil, window != nil, AXIsProcessTrusted(), hasPasteCommand(application) {
            keyboard=KeyboardInputDraft(pid:app.processIdentifier)
        }
        if !manual {
            // Chat clients can reuse the same AX editor when the user changes conversations.
            navigationMonitor = NSEvent.addGlobalMonitorForEvents(matching:[.leftMouseDown,.keyDown]) { [weak self] event in
                guard let self, let cg=event.cgEvent, cg.getIntegerValueField(.eventSourceUserData) != inputEventTag,
                      (cg.getIntegerValueField(.eventTargetUnixProcessID) == Int64(self.app.processIdentifier) ||
                       NSWorkspace.shared.frontmostApplication?.processIdentifier == self.app.processIdentifier) else { return }
                if self.keyboard != nil {
                    if event.type == .leftMouseDown || (event.type == .keyDown && !(event.keyCode==9 && event.modifierFlags.contains([.command,.option]))) {self.navigated=true}
                    return
                }
                if event.type == .leftMouseDown, let point=event.cgEvent?.location, let field=self.field {
                    var hit: AXUIElement?
                    guard AXUIElementCopyElementAtPosition(self.application,Float(point.x),Float(point.y),&hit) == .success else { self.navigated=true; return }
                    for _ in 0..<12 { if sameElement(hit,field) { return }; hit=hit.flatMap { child($0,kAXParentAttribute) } }
                    self.navigated=true
                } else if event.type == .keyDown, [36,76,48,53].contains(Int(event.keyCode)) { self.navigated=true }
            }
        }
    }
    func prepare() async {
        if let keyboard {
            do {
                for _ in 0..<40 {
                    if NSEvent.modifierFlags.intersection([.command,.option,.control,.shift]).isEmpty {break}
                    try await Task.sleep(nanoseconds:25_000_000)
                }
                guard NSEvent.modifierFlags.intersection([.command,.option,.control,.shift]).isEmpty else {throw InputPasteFailure("请松开快捷键后重试。")}
                try validateWindow();try await keyboard.capture();try validateWindow()
            }
            catch {self.keyboard=nil}
        }
    }
    func release() { if let navigationMonitor { NSEvent.removeMonitor(navigationMonitor); self.navigationMonitor=nil } }
    func context() -> [String:Any] {
        var focus:[String:Any]=["appName":app.localizedName ?? "当前应用","bundleId":app.bundleIdentifier ?? "pid.\(app.processIdentifier)","accessibility":AXIsProcessTrusted()]
        if let title {focus["windowTitle"]=title}
        if let draft {
            let text=draft.value as NSString, start=max(0,draft.range.location-2000), end=NSMaxRange(draft.range)
            focus["focusedText"]=text.substring(with:NSRange(location:start,length:draft.range.location-start))+String(draft.originalSelection.prefix(4000))+text.substring(with:NSRange(location:end,length:min(2000,text.length-end)))
            focus["selectedText"]=String(draft.originalSelection.prefix(4000))
        }
        if let keyboard {focus["selectedText"]=keyboard.original;focus["role"]="keyboard-input"}
        return focus
    }
    private func validateWindow() throws {
        guard !navigated else {throw InputPasteFailure("捕获后检测到原应用中的点击或按键。请结束任务并重新选择输入框。")}
        guard !app.isTerminated,!IsSecureEventInputEnabled() else {throw InputPasteFailure("原应用已退出或输入受到系统保护。")}
        guard let window,let current=child(application,kAXFocusedWindowAttribute) else {throw InputPasteFailure("应用没有提供当前窗口，请返回原窗口后重试。")}
        guard sameElement(window,current) else {throw InputPasteFailure("原窗口已切换，请重新选择输入框。")}
        guard title == attribute(window,kAXTitleAttribute) as? String,
              document == attribute(window,kAXDocumentAttribute) as? String else {throw InputPasteFailure("窗口内容或会话已切换，请重新选择输入框。")}
        guard child(application,kAXFocusedUIElementAttribute).map(protectedField) != true else {throw InputPasteFailure("当前输入位置受到保护。")}
    }

    private func validate(_ field: AXUIElement) throws {
        try validateWindow()
        guard sameElement(field,child(application,kAXFocusedUIElementAttribute)),!protectedField(field) else {throw InputPasteFailure("原输入框已切换，请重新选择。")}
    }
    func apply(_ command: [String:Any]) async throws {
        guard let text=command["text"] as? String, let from=command["from"] as? Int,
              let to=command["to"] as? Int, let expiry=command["expiresAt"] as? Double,
              version==from, abs(to-from)==1, to>=0 else { throw InputPasteFailure("草稿版本不匹配，请重新选择输入框。") }
        // Qt may expose no focused window while inactive. Restore the app first,
        // then compare the same captured window and draft before any edit.
        if !app.isActive {
            guard app.activate(options:[.activateIgnoringOtherApps]) else {throw InputPasteFailure("未能返回原输入框。")}
            for _ in 0..<20 { if app.isActive {break};try await Task.sleep(nanoseconds:25_000_000) }
        }
        guard app.isActive, Date().timeIntervalSince1970*1000 < expiry-2000 else {throw InputPasteFailure("输入框没有及时就绪，请重新选择。")}
        if let keyboard {
            try await keyboard.replace(with:text,restoreOriginal:to==0) {
                try self.validateWindow()
                guard self.app.isActive,Date().timeIntervalSince1970*1000<expiry else {throw InputPasteFailure("已离开原输入框或操作超时。")}
            }
            version=to;return
        }
        guard let field,var draft else {throw InputPasteFailure("未捕获可编辑的输入框。")}
        try validate(field)
        let replacement=to==0 ? draft.originalSelection : text
        let expected=try draft.replacing(in:fieldText(field),with:replacement)
        if !expected.utf16.elementsEqual(draft.value.utf16) {
            if selectedRange(field) != draft.range {
                var coordinates=CFRange(location:draft.range.location,length:draft.range.length)
                guard let value=AXValueCreate(.cfRange,&coordinates),
                      AXUIElementSetAttributeValue(field,kAXSelectedTextRangeAttribute as CFString,value) == .success,
                      selectedRange(field)==draft.range else {throw InputPasteFailure("应用无法重新选中原草稿片段。")}
            }
            try await paste(replacement,field:field,expected:expected)
        }
        draft.confirm(expected,replacement:replacement);self.draft=draft;version=to
    }
    private func paste(_ text:String, field:AXUIElement, expected:String) async throws {
        // Ordinary Paste updates web editors through their real input event. Never press Return.
        let board=text.isEmpty ? nil : try InputPasteboard()
        defer {board?.restore()}
        if !text.isEmpty {try board?.put(text)}
        try validate(field)
        guard app.isActive else {throw InputPasteFailure("已离开原输入框。")}
        try inputKey(text.isEmpty ? 51 : 9,text.isEmpty ? [] : .maskCommand,app.processIdentifier)
        for _ in 0..<35 {
            try await Task.sleep(nanoseconds:30_000_000)
            if fieldText(field)?.utf16.elementsEqual(expected.utf16)==true {return}
        }
        throw InputPasteFailure("已向原输入框执行粘贴，应用未确认文字。请检查草稿，勿重复写入。",started:true)
    }
}
