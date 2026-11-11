import AppKit
import Carbon
import ApplicationServices

struct DesktopShortcut: Codable, Equatable {
    var key: String
    var modifiers: [String]
    var title: String {
        let symbols = ["ctrl":"⌃", "alt":"⌥", "shift":"⇧", "meta":"⌘"]
        return ["ctrl","alt","shift","meta"].filter { modifiers.contains($0) }.map { symbols[$0]! }.joined() + (key == "Space" ? "空格" : key.uppercased())
    }
}

private final class SettingsDocumentView:NSView {override var isFlipped:Bool {true}}

final class DesktopSettings: NSObject, NSWindowDelegate {
    static let defaults: [String: DesktopShortcut] = [
        "magicCopy": .init(key:"c", modifiers:["alt"]),
        "addContent": .init(key:"c", modifiers:["meta","alt"]),
        "pasteToWord": .init(key:"v", modifiers:["meta","alt"]),
        "toggle": .init(key:"Space", modifiers:["meta","shift"]),
        "archive": .init(key:"h", modifiers:["meta","shift"]),
        "settings": .init(key:",", modifiers:["meta"]),
        "stop": .init(key:".", modifiers:["meta","shift"]),
    ]
    private static let actions = [("pasteToWord","在目标中使用内容", "在输入框写入和修改草稿，也可以选取 Office 对象或设计画框"), ("addContent","跨应用加入内容", "复制当前 App 的文字或图片并加入内容包"), ("magicCopy",ComponentLibrary.copyLabel, "复制当前选中的内容"), ("toggle","显示／收起妥帖", "桌面上的内容与推荐"), ("archive","查看归档", "已经完成的任务内容"), ("settings","打开设置", "模型与快捷键"), ("stop","停止当前任务", "取消正在生成的预览")]
    private static let keyCodes: [String:UInt32] = ["a":0,"s":1,"d":2,"f":3,"h":4,"g":5,"z":6,"x":7,"c":8,"v":9,"b":11,"q":12,"w":13,"e":14,"r":15,"y":16,"t":17,"1":18,"2":19,"3":20,"4":21,"6":22,"5":23,"=":24,"9":25,"7":26,"-":27,"8":28,"0":29,"]":30,"o":31,"u":32,"[":33,"i":34,"p":35,"l":37,"j":38,"'":39,"k":40,";":41,"\\":42,",":43,"/":44,"n":45,"m":46,".":47,"Space":49,"`":50]
    private let root: URL
    private let onAction: (String) -> Void
    private var shortcuts = defaults
    private var draft = defaults
    private var window: NSWindow?
    private var buttons: [String:NSButton] = [:]
    private var keyField: NSSecureTextField?
    private var baseField: NSTextField?
    private var modelField: NSTextField?
    private var notice: NSTextField?
    private var recording: String?
    private var keyMonitor: Any?
    private var handler: EventHandlerRef?
    private var hotkeys: [EventHotKeyRef] = []
    private var officeTap: CFMachPort?
    private var officeTapSource: CFRunLoopSource?
    private var activeShortcuts: [String:DesktopShortcut] = [:]
    private var swallowedOfficeKeyUp: Int64?

    init(root: URL, onAction: @escaping (String) -> Void) {
        self.root=root; self.onAction=onAction
        super.init()
        if let data=try? Data(contentsOf: root.appendingPathComponent(".local/settings.json")),
           let object=try? JSONSerialization.jsonObject(with:data) as? [String:Any],
           let saved=object["shortcuts"] as? [String:Any] {
            for (id, value) in saved {
                if value is NSNull { shortcuts.removeValue(forKey:id) }
                else if let data=try? JSONSerialization.data(withJSONObject:value), let shortcut=try? JSONDecoder().decode(DesktopShortcut.self,from:data) { shortcuts[id]=shortcut }
            }
        }
        var spec=EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, event, context in
            guard let event, let context else { return OSStatus(eventNotHandledErr) }
            var key=EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &key)
            let settings=Unmanaged<DesktopSettings>.fromOpaque(context).takeUnretainedValue()
            if settings.recording == nil, Int(key.id) < DesktopSettings.actions.count { settings.onAction(DesktopSettings.actions[Int(key.id)].0) }
            return noErr
        }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), &handler)
        installOfficeShortcutTap()
        _ = register(shortcuts)
    }

    /// Excel owns ⌥⌘V as Paste Special, so Carbon cannot reliably register it.
    /// An accessibility-authorized event tap owns only the configured Office
    /// shortcut and suppresses that one keystroke before the target app sees it.
    private func installOfficeShortcutTap() {
        let mask = (CGEventMask(1) << CGEventType.keyDown.rawValue) | (CGEventMask(1) << CGEventType.keyUp.rawValue)
        officeTap = CGEvent.tapCreate(tap:.cgSessionEventTap, place:.headInsertEventTap, options:.defaultTap, eventsOfInterest:mask, callback:{ _, type, event, context in
            guard let context else { return Unmanaged.passUnretained(event) }
            let settings = Unmanaged<DesktopSettings>.fromOpaque(context).takeUnretainedValue()
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                if let tap=settings.officeTap { CGEvent.tapEnable(tap:tap, enable:true) }
                return Unmanaged.passUnretained(event)
            }
            return settings.filterOfficeShortcut(type:type, event:event)
        }, userInfo:Unmanaged.passUnretained(self).toOpaque())
        guard let officeTap else { return }
        officeTapSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, officeTap, 0)
        if let officeTapSource { CFRunLoopAddSource(CFRunLoopGetMain(), officeTapSource, .commonModes) }
        CGEvent.tapEnable(tap:officeTap, enable:true)
    }

    private func filterOfficeShortcut(type:CGEventType, event:CGEvent) -> Unmanaged<CGEvent>? {
        let code=event.getIntegerValueField(.keyboardEventKeycode)
        if type == .keyUp, swallowedOfficeKeyUp == code { swallowedOfficeKeyUp=nil; return nil }
        guard type == .keyDown, recording == nil,
              let shortcut=activeShortcuts["pasteToWord"], let expected=Self.keyCodes[shortcut.key], code == Int64(expected) else {
            return Unmanaged.passUnretained(event)
        }
        let relevant:CGEventFlags=[.maskCommand,.maskControl,.maskAlternate,.maskShift]
        var expectedFlags:CGEventFlags=[]
        if shortcut.modifiers.contains("meta") { expectedFlags.insert(.maskCommand) }
        if shortcut.modifiers.contains("ctrl") { expectedFlags.insert(.maskControl) }
        if shortcut.modifiers.contains("alt") { expectedFlags.insert(.maskAlternate) }
        if shortcut.modifiers.contains("shift") { expectedFlags.insert(.maskShift) }
        guard event.flags.intersection(relevant) == expectedFlags else { return Unmanaged.passUnretained(event) }
        swallowedOfficeKeyUp=code
        if event.getIntegerValueField(.keyboardEventAutorepeat) == 0 { onAction("pasteToWord") }
        return nil
    }

    private func register(_ values: [String:DesktopShortcut]) -> Bool {
        hotkeys.forEach { UnregisterEventHotKey($0) }; hotkeys=[]
        activeShortcuts=values
        var success=true
        for (index, action) in Self.actions.enumerated() {
            // The event tap must own this chord in Office so Excel never sees
            // its built-in Paste Special command. Carbon remains a fallback
            // only when the tap could not be created (for example, before
            // Accessibility permission is granted).
            if action.0 == "pasteToWord", officeTap != nil { continue }
            guard let shortcut=values[action.0], let code=Self.keyCodes[shortcut.key] else { continue }
            var flags:UInt32=0
            if shortcut.modifiers.contains("meta") { flags |= UInt32(cmdKey) }
            if shortcut.modifiers.contains("ctrl") { flags |= UInt32(controlKey) }
            if shortcut.modifiers.contains("alt") { flags |= UInt32(optionKey) }
            if shortcut.modifiers.contains("shift") { flags |= UInt32(shiftKey) }
            var ref:EventHotKeyRef?
            let result=RegisterEventHotKey(code,flags,EventHotKeyID(signature:0x54555449,id:UInt32(index)),GetApplicationEventTarget(),0,&ref)
            if result == noErr, let ref { hotkeys.append(ref) } else { success=false }
        }
        return success
    }

    func show() {
        if let window { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true); return }
        draft=shortcuts
        let panel=NSWindow(contentRect:NSRect(x:0,y:0,width:500,height:min(800,(NSScreen.main?.visibleFrame.height ?? 880)-80)),styleMask:[.titled,.closable],backing:.buffered,defer:false)
        panel.title="妥帖设置"; panel.isReleasedWhenClosed=false; panel.delegate=self
        panel.contentView?.wantsLayer=true;panel.contentView?.layer?.backgroundColor=ComponentLibrary.paper.cgColor
        let scroll=NSScrollView(frame:panel.contentView!.bounds);scroll.autoresizingMask=[.width,.height];scroll.hasVerticalScroller=true;scroll.drawsBackground=false
        let document=SettingsDocumentView();document.translatesAutoresizingMaskIntoConstraints=false;scroll.documentView=document;panel.contentView!.addSubview(scroll)
        let content=NSStackView(); content.orientation = .vertical; content.alignment = .leading; content.spacing=14
        content.translatesAutoresizingMaskIntoConstraints=false;document.addSubview(content)
        NSLayoutConstraint.activate([document.widthAnchor.constraint(equalTo:scroll.contentView.widthAnchor),content.leadingAnchor.constraint(equalTo:document.leadingAnchor,constant:28),content.trailingAnchor.constraint(equalTo:document.trailingAnchor,constant:-28),content.topAnchor.constraint(equalTo:document.topAnchor,constant:24),content.bottomAnchor.constraint(equalTo:document.bottomAnchor,constant:-24)])
        func label(_ text:String,_ size:CGFloat=13,_ bold:Bool=false)->NSTextField {
            let field=NSTextField(wrappingLabelWithString:text);field.font=ComponentLibrary.font(size,bold:bold);field.textColor=ComponentLibrary.ink;return field
        }
        func styleField(_ field:NSTextField) {
            field.font=ComponentLibrary.font(12);field.textColor=ComponentLibrary.ink;field.isBezeled=false
            field.drawsBackground=false;field.translatesAutoresizingMaskIntoConstraints=false
            content.removeArrangedSubview(field);field.removeFromSuperview()
            let wrapper=NSView();wrapper.wantsLayer=true;wrapper.layer?.backgroundColor=ComponentLibrary.control.cgColor
            wrapper.layer?.cornerRadius=8;wrapper.layer?.borderWidth=0.5;wrapper.layer?.borderColor=ComponentLibrary.line.cgColor
            wrapper.addSubview(field);content.addArrangedSubview(wrapper)
            NSLayoutConstraint.activate([wrapper.widthAnchor.constraint(equalTo:content.widthAnchor),wrapper.heightAnchor.constraint(equalToConstant:34),field.leadingAnchor.constraint(equalTo:wrapper.leadingAnchor,constant:8),field.trailingAnchor.constraint(equalTo:wrapper.trailingAnchor,constant:-8),field.centerYAnchor.constraint(equalTo:wrapper.centerYAnchor)])
        }
        content.addArrangedSubview(label("让妥帖按你的习惯工作",18,true))
        content.addArrangedSubview(label("模型",14,true))
        content.addArrangedSubview(label("OpenAI 兼容 · Chat Completions",12))
        let config=readConfig()
        content.addArrangedSubview(label("接口地址（Base URL）",12,true))
        let base=NSTextField(string:config["OPENAI_BASE_URL"] ?? config["ARK_BASE_URL"] ?? "https://api.deepseek.com");base.placeholderString="https://api.deepseek.com";baseField=base;content.addArrangedSubview(base)
        styleField(base)
        content.addArrangedSubview(label("模型名称",12,true))
        let model=NSTextField(string:config["OPENAI_MODEL"] ?? config["ARK_MODEL"] ?? "deepseek-flash");model.placeholderString="输入服务提供的模型 ID";modelField=model;content.addArrangedSubview(model)
        styleField(model)
        content.addArrangedSubview(label("API Key",12,true))
        let configured = !(config["OPENAI_API_KEY"] ?? config["ARK_API_KEY"] ?? "").isEmpty
        let key=NSSecureTextField();key.placeholderString=configured ? "已配置，留空保留当前 Key" : "输入 API Key，本地服务可留空";key.bezelStyle = .roundedBezel;keyField=key
        content.addArrangedSubview(key)
        styleField(key)
        let privacy=label("Key 只保存在本机。更换服务时，请填写对应的 Key。",12);privacy.textColor = ComponentLibrary.muted;content.addArrangedSubview(privacy)
        content.addArrangedSubview(label("选区操作",14,true))
        let selectionStatus=label(AXIsProcessTrusted() ? "辅助功能已开启，选中文字即可加入内容包。" : "辅助功能未开启。开启后，选中文字即可显示操作条，无需浏览器扩展。",12)
        selectionStatus.textColor = ComponentLibrary.muted;content.addArrangedSubview(selectionStatus)
        content.addArrangedSubview(ComponentActionButton(title:"打开辅助功能设置…",target:self,action:#selector(openAccessibility)))
        content.addArrangedSubview(label("快捷键",14,true))
        for (id,title,detail) in Self.actions {
            let row=NSStackView();row.orientation = .horizontal;row.spacing=12;
            let names=NSStackView();names.orientation = .vertical;names.alignment = .leading;names.spacing=3;names.addArrangedSubview(label(title,12,true));let hint=label(detail,12);hint.textColor = ComponentLibrary.muted;names.addArrangedSubview(hint)
            row.addArrangedSubview(names);row.addArrangedSubview(NSView())
            let button=ComponentActionButton(title:draft[id]?.title ?? "未设置",target:self,action:#selector(recordShortcut(_:)));button.identifier=NSUserInterfaceItemIdentifier(id);button.widthAnchor.constraint(equalToConstant:132).isActive=true;buttons[id]=button;row.addArrangedSubview(button);content.addArrangedSubview(row);row.widthAnchor.constraint(equalTo:content.widthAnchor).isActive=true
        }
        let hint=label("点击快捷键后按下组合键；Delete 清除，Esc 取消。",12);hint.textColor = ComponentLibrary.muted;content.addArrangedSubview(hint)
        let status=label("",12);notice=status;content.addArrangedSubview(status)
        let footer=NSStackView();footer.spacing=10;footer.addArrangedSubview(ComponentActionButton(title:"恢复默认",target:self,action:#selector(resetDefaults)));let save=ComponentActionButton(title:"保存设置",target:self,action:#selector(save),primary:true);footer.addArrangedSubview(save);content.addArrangedSubview(footer)
        window=panel;panel.center();panel.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
        keyMonitor=NSEvent.addLocalMonitorForEvents(matching:.keyDown) { [weak self] event in
            guard let self, let id=self.recording, event.window === self.window else { return event }
            if event.keyCode == 53 { self.recording=nil;self.updateButtons();_ = self.register(self.shortcuts);return nil }
            if event.keyCode == 51 { self.draft.removeValue(forKey:id);self.recording=nil;self.updateButtons();_ = self.register(self.shortcuts);return nil }
            guard let key=Self.keyCodes.first(where:{$0.value==UInt32(event.keyCode)})?.key else { self.notice?.stringValue="请选择字母、数字、空格或标点组合。";return nil }
            let flags=event.modifierFlags
            var modifiers:[String]=[]
            if flags.contains(.command) {modifiers.append("meta")};if flags.contains(.control){modifiers.append("ctrl")};if flags.contains(.option){modifiers.append("alt")};if flags.contains(.shift){modifiers.append("shift")}
            guard modifiers.contains(where:{$0 != "shift"}) else { self.notice?.stringValue="请包含 ⌘、⌃ 或 ⌥，避免影响正常输入。";return nil }
            if key == "v" && modifiers == ["meta"] { self.notice?.stringValue="⌘V 保留给系统粘贴，请选其他组合。";return nil }
            let next=DesktopShortcut(key:key,modifiers:modifiers)
            guard !self.draft.contains(where:{$0.key != id && $0.value == next}) else {self.notice?.stringValue="这个组合已用于另一个操作。";return nil}
            self.draft[id]=next;self.recording=nil;self.notice?.stringValue="保存后生效。";self.updateButtons();_ = self.register(self.shortcuts);return nil
        }
    }
    @objc private func openAccessibility() {
        if let url=URL(string:"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {NSWorkspace.shared.open(url)}
    }
    private func readConfig()->[String:String] {
        var result:[String:String]=[:]
        for line in ((try? String(contentsOf:root.appendingPathComponent(".env.local"),encoding:.utf8)) ?? "").components(separatedBy:"\n") {
            guard !line.hasPrefix("#"),let split=line.firstIndex(of:"=") else {continue}
            let name=String(line[..<split]),value=String(line[line.index(after:split)...]).trimmingCharacters(in:.whitespaces)
            if value.hasPrefix("\""),let data=value.data(using:.utf8),let decoded=try? JSONSerialization.jsonObject(with:data,options:.fragmentsAllowed) as? String {result[name]=decoded} else {result[name]=value}
        }
        return result
    }
    @objc private func recordShortcut(_ sender:NSButton) {hotkeys.forEach { UnregisterEventHotKey($0) };hotkeys=[];recording=sender.identifier?.rawValue;updateButtons();sender.title="按下快捷键…";notice?.stringValue=""}
    func windowWillClose(_ notification:Notification) {if recording != nil {recording=nil;_ = register(shortcuts)};if let keyMonitor {NSEvent.removeMonitor(keyMonitor);self.keyMonitor=nil};keyField?.stringValue="";keyField=nil;baseField=nil;modelField=nil;buttons=[:];window=nil}
    private func updateButtons(){for(id,button) in buttons {button.title=draft[id]?.title ?? "未设置"}}
    @objc private func resetDefaults(){draft=Self.defaults;recording=nil;_ = register(shortcuts);updateButtons();notice?.stringValue="保存后恢复默认快捷键。"}
    @objc private func save(){
        recording=nil
        guard register(draft) else {_ = register(shortcuts);notice?.stringValue="快捷键被系统或其他应用占用，请换一个组合。";return}
        do {
            let local=root.appendingPathComponent(".local");try FileManager.default.createDirectory(at:local,withIntermediateDirectories:true)
            let map=Dictionary(uniqueKeysWithValues:Self.actions.map { action -> (String,Any) in
                guard let value=draft[action.0] else{return(action.0,NSNull())}
                return(action.0,["key":value.key,"modifiers":value.modifiers])
            })
            let key=keyField?.stringValue.trimmingCharacters(in:.whitespacesAndNewlines) ?? ""
            guard !key.contains("\n"), !key.contains("\r") else {notice?.stringValue="API Key 不能包含换行。";_ = register(shortcuts);return}
            let base=baseField?.stringValue.trimmingCharacters(in:.whitespacesAndNewlines) ?? ""
            let model=modelField?.stringValue.trimmingCharacters(in:.whitespacesAndNewlines) ?? ""
            guard let url=URLComponents(string:base), ["http","https"].contains(url.scheme ?? ""), url.host != nil, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, !model.isEmpty, !model.contains("\n"), !model.contains("\r") else {notice?.stringValue="请填写有效的 HTTP(S) Base URL 与模型名称。";_ = register(shortcuts);return}
            let config=readConfig(),oldBase=config["OPENAI_BASE_URL"] ?? config["ARK_BASE_URL"] ?? "https://api.deepseek.com"
            func normalized(_ value:String)->String {var result=value;while result.hasSuffix("/"){result.removeLast()};if result.hasSuffix("/chat/completions"){result=String(result.dropLast(17))};return result}
            let savedKey = !key.isEmpty ? key : normalized(base)==normalized(oldBase) ? config["OPENAI_API_KEY"] ?? config["ARK_API_KEY"] ?? "" : ""
            let file=root.appendingPathComponent(".env.local")
            var lines=((try? String(contentsOf:file,encoding:.utf8)) ?? "").components(separatedBy:"\n").filter{ !$0.hasPrefix("OPENAI_API_KEY=") && !$0.hasPrefix("OPENAI_BASE_URL=") && !$0.hasPrefix("OPENAI_MODEL=") }
            for (name,value) in [("OPENAI_API_KEY",savedKey),("OPENAI_BASE_URL",base),("OPENAI_MODEL",model)] {
                let encoded=String(data:try JSONSerialization.data(withJSONObject:value,options:.fragmentsAllowed),encoding:.utf8)!
                lines.append("\(name)=\(encoded)")
            }
            try (lines.joined(separator:"\n")+"\n").write(to:file,atomically:true,encoding:.utf8)
            try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path)
            keyField?.stringValue="";keyField?.placeholderString=savedKey.isEmpty ? "输入 API Key，本地服务可留空" : "已配置，留空保留当前 Key"
            try JSONSerialization.data(withJSONObject:["shortcuts":map],options:.prettyPrinted).write(to:local.appendingPathComponent("settings.json"),options:.atomic)
            shortcuts=draft;notice?.stringValue="已保存。网页快捷键在回到网页时生效。"
        } catch { _ = register(shortcuts);notice?.stringValue="设置没有保存，请重试。" }
    }
}
