import AppKit

/// Owned by Tuotie, shared by every target adapter. Only this layer owns the visual window.
final class ResultOverlayManager {
    private let renderer=ResultOverlay()
    private var generation=0
    private var watch:Timer?
    private var geometryWatch:Timer?
    private var consumed=Set<String>()
    private var order:[String]=[]
    var onOutcome:((String,String)->Void)?
    private(set) var lastFailure:String?
    var currentID:String?{renderer.currentID}
    var panel:NSPanel?{renderer.panel}
    @discardableResult func show(id:String,screenFrame:NSRect,regions:[NSRect],label:String,duration:Double=2.6)->Bool {
        renderer.show(id:id,screenFrame:screenFrame,regions:regions,label:label,duration:duration)
    }
    func hide(){generation += 1;watch?.invalidate();watch=nil;geometryWatch?.invalidate();geometryWatch=nil;renderer.hide()}
    /// Resolution never changes the target selection or content. Every result is checked again before drawing.
    func present(id:String,app:NSRunningApplication,window:NSRect,receipt:[String:Any],valid:@escaping()->Bool) {
        guard !consumed.contains(id) else{return}
        consumed.insert(id);order.append(id)
        if order.count>256{consumed.remove(order.removeFirst())}
        hide();let token=generation,expires=Date().addingTimeInterval(4)
        let top=NSScreen.screens.first?.frame.maxY ?? 0
        DispatchQueue.global(qos:.userInitiated).async{[weak self] in
            let regions=ResultLocator.resolve(app:app,window:window,receipt:receipt,desktopTop:top)
            DispatchQueue.main.async{[weak self] in
                guard let self,self.generation==token,Date()<expires,valid(),ResultLocator.focusedWindowMatches(app:app,window:window,desktopTop:top) else{return}
                guard !regions.isEmpty else{self.lastFailure="未取得本次修改范围的可信屏幕坐标";self.onOutcome?(id,"unavailable");return}
                self.lastFailure=nil
                guard self.renderer.show(id:id,screenFrame:window,regions:regions,label:"已更新内容",duration:2.6) else{return}
                self.onOutcome?(id,"displayed")
                self.watch=Timer.scheduledTimer(withTimeInterval:0.08,repeats:true){[weak self] timer in
                    guard let self,self.generation==token else{timer.invalidate();return}
                    guard self.renderer.currentID==id,valid(),ResultLocator.focusedWindowMatches(app:app,window:window,desktopTop:top) else{timer.invalidate();self.hide();return}
                }
                // Programmatic reflow, zoom or page changes may not produce an input event.
                // Re-read the same host identities; hide rather than follow unverified geometry.
                var checking=false
                self.geometryWatch=Timer.scheduledTimer(withTimeInterval:0.5,repeats:true){[weak self] timer in
                    guard let self,self.generation==token,self.renderer.currentID==id else{timer.invalidate();return}
                    guard !checking else{return};checking=true
                    DispatchQueue.global(qos:.utility).async{
                        let current=ResultLocator.resolve(app:app,window:window,receipt:receipt,desktopTop:top)
                        DispatchQueue.main.async{[weak self] in
                            checking=false
                            guard let self,self.generation==token else{return}
                            let same=current.count==regions.count && zip(current,regions).allSatisfy{a,b in abs(a.minX-b.minX)<2 && abs(a.minY-b.minY)<2 && abs(a.width-b.width)<2 && abs(a.height-b.height)<2}
                            if !same || !valid(){self.hide()}
                        }
                    }
                }
            }
        }
    }
    deinit {watch?.invalidate();geometryWatch?.invalidate()}
}
