import AppKit
import ApplicationServices
import Carbon

private func dropAttribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
private func dropElement(_ element: AXUIElement, _ name: String) -> AXUIElement? {
    guard let value = dropAttribute(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}

/// Only real package gestures enter this receiver. ResultOverlay never handles
/// input, moves the pointer or changes an editor's selection.
enum NativeDropGeometry {
    static func quartz(_ point: NSPoint, primaryTop: CGFloat) -> CGPoint {
        CGPoint(x: point.x, y: primaryTop - point.y)
    }
    static func cocoa(_ rect: CGRect, primaryTop: CGFloat) -> CGRect {
        CGRect(x: rect.minX, y: primaryTop - rect.maxY, width: rect.width, height: rect.height)
    }
    static func host(_ bundle: String) -> String? {
        if ["org.blenderfoundation.blender", "com.lemon.lvpro", "com.lemon.lvoverseas"].contains(bundle) { return nil }
        return ["com.microsoft.Word":"word", "com.microsoft.Excel":"excel", "com.microsoft.Powerpoint":"powerpoint", "com.figma.Desktop":"figma"][bundle] ?? "input"
    }
    static func valid(frame: CGRect, point: CGPoint) -> Bool {
        [frame.minX,frame.minY,frame.width,frame.height,point.x,point.y].allSatisfy(\.isFinite)
            && frame.width > 120 && frame.height > 100 && frame.contains(point)
    }
}

@MainActor struct NativeDropTarget {
    let sessionID: String
    let app: NSRunningApplication
    let windowID: CGWindowID
    let frame: CGRect // WindowServer points, top-left origin; never Retina pixels.
    let point: NSPoint // AppKit global coordinates, including negative displays.
    let host: String
    let window: AXUIElement
    let hit: AXUIElement
    let editable: Bool
    let title: String
    let document: String
    let receivedAt: Date

    var quartzPoint: CGPoint { NativeDropGeometry.quartz(point, primaryTop: NSScreen.screens.first?.frame.maxY ?? 0) }
    func valid() -> Bool {
        guard Date().timeIntervalSince(receivedAt) < 15, !app.isTerminated,
              let current = NativePackDrop.window(at: quartzPoint), current.id == windowID,
              current.pid == app.processIdentifier, current.frame == frame,
              dropAttribute(window,kAXTitleAttribute) as? String ?? "" == title,
              dropAttribute(window,kAXDocumentAttribute) as? String ?? "" == document else { return false }
        return true
    }

    /// A drop chooses a location. Deliver one selection click at that exact
    /// physical release point to that PID only, then let Office/Plugin APIs own
    /// the tracked object. Never paste the .okpaste file or press a hotkey.
    func position() async throws -> [String:Any] {
        guard AXIsProcessTrusted(), !IsSecureEventInputEnabled(), valid() else {
            throw InputPasteFailure("落点窗口已变化或缺少辅助功能权限，请重新拖入。")
        }
        if !app.isActive {
            _ = AXUIElementPerformAction(window,kAXRaiseAction as CFString)
            guard app.activate(options:[.activateIgnoringOtherApps]) else { throw InputPasteFailure("无法激活落点窗口。") }
        }
        for _ in 0..<20 {
            if app.isActive { break }
            try await Task.sleep(nanoseconds:20_000_000)
        }
        guard app.isActive, valid(), NSEvent.pressedMouseButtons == 0 else { throw InputPasteFailure("落点已变化，请松开鼠标后重新拖入。") }
        let application = AXUIElementCreateApplication(app.processIdentifier)
        guard let focused = dropElement(application,kAXFocusedWindowAttribute), CFEqual(focused,window) else { throw InputPasteFailure("当前不是刚才的落点窗口，请重新拖入。") }
        var proof: [String:Any] = ["id":sessionID,"host":host,"windowId":windowID,"x":quartzPoint.x,"y":quartzPoint.y,"positioned":false,"capturedAt":Date().timeIntervalSince1970*1000]
        // Figma receives the original native file drop. Its DropEvent supplies
        // the hit node/canvas position, independently of its active tool/selection.
        if host=="figma" {proof["positioned"]=true;return proof}
        // A visual-context drop is deliberately copy-only; it must not attach
        // to an unrelated editor that happened to be focused beforehand.
        guard host != "input" || editable else { return proof }
        guard let down = CGEvent(mouseEventSource:CGEventSource(stateID:.privateState),mouseType:.leftMouseDown,mouseCursorPosition:quartzPoint,mouseButton:.left),
              let up = CGEvent(mouseEventSource:CGEventSource(stateID:.privateState),mouseType:.leftMouseUp,mouseCursorPosition:quartzPoint,mouseButton:.left) else { throw InputPasteFailure("系统没有接受落点定位。") }
        for event in [down,up] {
            event.flags=[]
            event.setIntegerValueField(.mouseEventClickState,value:1)
            event.setIntegerValueField(.eventSourceUserData,value:0x54554452)
            event.postToPid(app.processIdentifier)
        }
        try await Task.sleep(nanoseconds:120_000_000)
        guard valid(), app.isActive, NSEvent.pressedMouseButtons == 0,
              let current = dropElement(application,kAXFocusedWindowAttribute), CFEqual(current,window) else { throw InputPasteFailure("定位期间窗口已变化，未建立任务。") }
        if host == "input" {
            guard let focused = dropElement(application,kAXFocusedUIElementAttribute), Self.related(focused,hit) else { throw InputPasteFailure("落点输入框没有获得焦点，请重新拖到输入区。") }
        }
        if host == "excel" {
            guard let address = Self.cellAddress(window), address.range(of:"^\\$?[A-Z]{1,3}\\$?[1-9][0-9]{0,6}$",options:.regularExpression) != nil else { throw InputPasteFailure("没有确认落点单元格，请拖到普通单元格中。") }
            proof["cellAddress"] = address.replacingOccurrences(of:"$",with:"")
        }
        proof["positioned"] = true
        return proof
    }
    private static func related(_ a:AXUIElement,_ b:AXUIElement) -> Bool {
        for (start,target) in [(a,b),(b,a)] {
            var node:AXUIElement?=start
            for _ in 0..<8 { guard let current=node else {break};if CFEqual(current,target){return true};node=dropElement(current,kAXParentAttribute) }
        }
        return false
    }
    private static func cellAddress(_ window:AXUIElement) -> String? {
        var visited=0
        func find(_ element:AXUIElement,_ depth:Int) -> String? {
            visited += 1;guard depth < 12,visited < 700 else {return nil}
            if dropAttribute(element,"AXIdentifier") as? String == "NameBox" { return dropAttribute(element,kAXValueAttribute) as? String }
            for child in dropAttribute(element,kAXChildrenAttribute) as? [AXUIElement] ?? [] {if let value=find(child,depth+1){return value}}
            return nil
        }
        return find(window,0)
    }
    func screenshot() -> String? {
        guard valid(), CGPreflightScreenCaptureAccess(),
              let image=CGWindowListCreateImage(.null,.optionIncludingWindow,windowID,[.boundsIgnoreFraming,.bestResolution]) else { return nil }
        let scale=min(1,1400/CGFloat(max(image.width,image.height)))
        let size=CGSize(width:CGFloat(image.width)*scale,height:CGFloat(image.height)*scale)
        guard let context=CGContext(data:nil,width:Int(size.width),height:Int(size.height),bitsPerComponent:8,bytesPerRow:0,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.draw(image,in:CGRect(origin:.zero,size:size))
        guard let resized=context.makeImage(),let data=NSBitmapImageRep(cgImage:resized).representation(using:.jpeg,properties:[.compressionFactor:0.78]),data.count < 1_500_000 else {return nil}
        return "data:image/jpeg;base64,"+data.base64EncodedString()
    }
}

/// Transparent, non-key drag destinations exist only during our own session.
/// They stop Office/chat clients importing the package file as an attachment.
@MainActor final class NativePackDrop {
    static let type = NSPasteboard.PasteboardType("com.tuotie.content-package")
    struct Window {let id:CGWindowID;let pid:pid_t;let frame:CGRect}
    private var sessionID:String?
    private var panel:DropPanel?
    private var timer:Timer?
    private var pending:NativeDropTarget?
    private var source:AnyObject?
    private var bound:Window?

    static func window(at point:CGPoint) -> Window? {
        guard let windows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] else {return nil}
        for row in windows {
            guard let pid=(row[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value,pid != getpid(),
                  (row[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
                  (row[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1 > 0,
                  let data=row[kCGWindowBounds as String] as? [String:Any],let frame=CGRect(dictionaryRepresentation:data as CFDictionary),
                  frame.contains(point),let id=(row[kCGWindowNumber as String] as? NSNumber)?.uint32Value else {continue}
            // Do not search through an unrelated foreground window for an Office target.
            return Window(id:id,pid:pid,frame:frame)
        }
        return nil
    }
    func begin(id:String,source:AnyObject) {
        stop();sessionID=id;self.source=source
        let timer=Timer(timeInterval:0.06,repeats:true){[weak self] _ in MainActor.assumeIsolated { self?.refresh() }}
        self.timer=timer;RunLoop.main.add(timer,forMode:.common);refresh()
    }
    func finish(id:String,accepted:Bool,at point:NSPoint) -> NativeDropTarget? {
        var result=accepted && sessionID==id ? pending : nil
        let q=NativeDropGeometry.quartz(point,primaryTop:NSScreen.screens.first?.frame.maxY ?? 0)
        if result == nil,accepted,sessionID==id,let window=Self.window(at:q),NSRunningApplication(processIdentifier:window.pid)?.bundleIdentifier=="com.figma.Desktop" {
            result=resolve(id:id,point:point,window:window)
        }
        stop();return result
    }
    func stop() {
        timer?.invalidate();timer=nil;panel?.orderOut(nil);panel?.close();panel=nil
        pending=nil;sessionID=nil;source=nil;bound=nil
    }
    private func refresh() {
        guard sessionID != nil,pending == nil else {panel?.orderOut(nil);return}
        let point=NativeDropGeometry.quartz(NSEvent.mouseLocation,primaryTop:NSScreen.screens.first?.frame.maxY ?? 0)
        guard let window=Self.window(at:point),NativeDropGeometry.valid(frame:window.frame,point:point),
              let app=NSRunningApplication(processIdentifier:window.pid),let bundle=app.bundleIdentifier,
              bundle != "com.figma.Desktop",NativeDropGeometry.host(bundle) != nil else {panel?.orderOut(nil);bound=nil;return}
        if panel == nil {
            let panel=DropPanel(contentRect:.zero,styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
            panel.level = .floating;panel.backgroundColor = .clear;panel.isOpaque=false;panel.hasShadow=false
            panel.hidesOnDeactivate=false;panel.collectionBehavior=[.canJoinAllSpaces,.fullScreenAuxiliary]
            let view=DropView();view.receiver=self;panel.contentView=view;self.panel=panel
        }
        bound=window
        panel?.setFrame(NativeDropGeometry.cocoa(window.frame,primaryTop:NSScreen.screens.first?.frame.maxY ?? 0),display:false)
        panel?.orderFrontRegardless()
    }
    fileprivate func target(_ sender:NSDraggingInfo) -> NativeDropTarget? {
        guard pending == nil,let id=sessionID,sender.draggingPasteboard.string(forType:Self.type)==id,
              let source,let actual=sender.draggingSource as AnyObject?,actual === source,
              AXIsProcessTrusted(),!IsSecureEventInputEnabled(),let window=bound,
              let destination=sender.draggingDestinationWindow else {return nil}
        let point=destination.convertPoint(toScreen:sender.draggingLocation)
        return resolve(id:id,point:point,window:window)
    }
    private func resolve(id:String,point:NSPoint,window:Window) -> NativeDropTarget? {
        guard AXIsProcessTrusted(),!IsSecureEventInputEnabled() else {return nil}
        let q=NativeDropGeometry.quartz(point,primaryTop:NSScreen.screens.first?.frame.maxY ?? 0)
        guard let top=Self.window(at:q),top.id==window.id,top.pid==window.pid,top.frame==window.frame,
              let app=NSRunningApplication(processIdentifier:window.pid),let host=NativeDropGeometry.host(app.bundleIdentifier ?? "") else {return nil}
        let application=AXUIElementCreateApplication(window.pid);AXUIElementSetMessagingTimeout(application,0.15)
        var hit:AXUIElement?
        guard AXUIElementCopyElementAtPosition(application,Float(q.x),Float(q.y),&hit) == .success,let hit,
              let axWindow=dropElement(hit,kAXWindowAttribute) ?? (dropAttribute(hit,kAXRoleAttribute) as? String == "AXWindow" ? hit : nil) else {return nil}
        var node:AXUIElement?=hit,content=false,editable=false,blocked=false
        for _ in 0..<18 {
            guard let current=node else {break}
            let role=dropAttribute(current,kAXRoleAttribute) as? String ?? ""
            let subrole=dropAttribute(current,kAXSubroleAttribute) as? String ?? ""
            let description=dropAttribute(current,kAXDescriptionAttribute) as? String ?? ""
            if role=="AXSecureTextField" || subrole=="AXSecureTextField" || dropAttribute(current,"AXProtectedContent") as? Bool == true {return nil}
            if ["AXButton","AXMenuItem","AXToolbar","AXTabGroup","AXLink","AXScrollBar"].contains(role){blocked=true}
            var valueWritable=DarwinBoolean(false),textWritable=DarwinBoolean(false)
            AXUIElementIsAttributeSettable(current,kAXValueAttribute as CFString,&valueWritable)
            AXUIElementIsAttributeSettable(current,kAXSelectedTextAttribute as CFString,&textWritable)
            if ["AXTextArea","AXTextField"].contains(role) && subrole != "AXSearchField" && dropAttribute(current,"AXReadOnly") as? Bool != true &&
                (valueWritable.boolValue || textWritable.boolValue || dropAttribute(current,"AXEditable") as? Bool == true) {editable=true}
            if host=="figma" && ["Left sidebar","Right sidebar","Application toolbar","Help/zoom toolbar"].contains(description){blocked=true}
            if host=="word" && (description=="Document Pane" || description.hasPrefix("Page ") || description.contains("页面") || description.contains("文档")){content=true}
            if host=="excel" && (description.hasPrefix("Workbook area") || description.contains("工作簿区域")){content=true}
            if host=="powerpoint" && (description.hasPrefix("Slide Editor Pane") || description.contains("幻灯片编辑")){content=true}
            if host=="figma" && (role=="AXWebArea" || description.lowercased().contains("canvas")){content=true}
            node=dropElement(current,kAXParentAttribute)
        }
        guard (!blocked || host=="input" && !editable),host=="input" || content else {return nil}
        return NativeDropTarget(sessionID:id,app:app,windowID:window.id,frame:window.frame,point:point,host:host,window:axWindow,hit:hit,editable:editable,title:dropAttribute(axWindow,kAXTitleAttribute) as? String ?? "",document:dropAttribute(axWindow,kAXDocumentAttribute) as? String ?? "",receivedAt:Date())
    }
    fileprivate func accept(_ sender:NSDraggingInfo) -> Bool {
        guard let target=target(sender) else {return false}
        pending=target;panel?.orderOut(nil);return true
    }
}

/// A second physical action or focus switch invalidates an unfinished capture.
/// It never cancels a task belonging to a different drop nonce.
@MainActor final class NativeDropWatch {
    private var global:Any?
    private var local:Any?
    private(set) var changed=false
    init() {
        let mask:NSEvent.EventTypeMask=[.leftMouseDown,.rightMouseDown,.keyDown,.scrollWheel]
        func observe(_ event:NSEvent) {
            let tag=event.cgEvent?.getIntegerValueField(.eventSourceUserData)
            if tag != 0x54554452 && tag != 0x5455494e {changed=true}
        }
        global=NSEvent.addGlobalMonitorForEvents(matching:mask){event in MainActor.assumeIsolated {observe(event)}}
        local=NSEvent.addLocalMonitorForEvents(matching:mask){event in MainActor.assumeIsolated {observe(event)};return event}
    }
    func close(){if let global{NSEvent.removeMonitor(global)};if let local{NSEvent.removeMonitor(local)};global=nil;local=nil}
}

private final class DropPanel:NSPanel {
    override var canBecomeKey:Bool {false}
    override var canBecomeMain:Bool {false}
}
private final class DropView:NSView {
    weak var receiver:NativePackDrop?
    override init(frame:NSRect){super.init(frame:frame);registerForDraggedTypes([NativePackDrop.type])}
    required init?(coder:NSCoder){nil}
    override func draggingEntered(_ sender:NSDraggingInfo)->NSDragOperation {receiver?.target(sender) == nil ? [] : .copy}
    override func draggingUpdated(_ sender:NSDraggingInfo)->NSDragOperation {draggingEntered(sender)}
    override func prepareForDragOperation(_ sender:NSDraggingInfo)->Bool {receiver?.target(sender) != nil}
    override func performDragOperation(_ sender:NSDraggingInfo)->Bool {receiver?.accept(sender) ?? false}
    override func wantsPeriodicDraggingUpdates()->Bool {true}
}
