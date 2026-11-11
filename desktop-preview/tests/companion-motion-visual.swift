import AppKit
import WebKit

// Isolated, real WebKit review of the same SVG component and animation tracks
// used by the dock. It does not activate the app or access the clipboard.
final class CompanionMotionVisualCheck: NSObject, WKNavigationDelegate {
    var finished = false
    var failure: String?
    private var webView: WKWebView!
    private var window: NSWindow!
    private var root: URL!
    private var output: URL!
    private var reduced = false
    private var readinessAttempts = 0
    private var index = 0
    private var records: [[String: Any]] = []
    private var signatures: [String: String] = [:]
    private var firstWork: String?
    private struct Frame {
        let name: String
        let pose: String
        let time: Int
        var width: CGFloat = 1024
        var height: CGFloat = 1000
    }
    private let normalFrames = [
        Frame(name:"idle-reference", pose:"idle", time:0),
        Frame(name:"idle-blink", pose:"idle", time:4127),
        Frame(name:"content-nod", pose:"nod", time:240),
        Frame(name:"task-wink", pose:"received", time:350),
        Frame(name:"thinking-bubbles", pose:"thinking", time:720),
        Frame(name:"failure-bow", pose:"failure", time:700),
        Frame(name:"working-0000", pose:"working", time:0),
        Frame(name:"working-0600", pose:"working", time:600),
        Frame(name:"working-1200", pose:"working", time:1200),
        Frame(name:"working-2400", pose:"working", time:2400),
        Frame(name:"working-repeat-0600", pose:"working", time:600),
        Frame(name:"success-0000", pose:"success", time:0),
        Frame(name:"success-0240", pose:"success", time:240),
        Frame(name:"success-0400", pose:"success", time:400),
        Frame(name:"success-0700", pose:"success", time:700),
        Frame(name:"success-1450", pose:"success", time:1450),
        Frame(name:"success-repeat-0400", pose:"success", time:400),
        Frame(name:"narrow-390-working", pose:"working", time:600, width:390, height:900),
        Frame(name:"narrow-340-success", pose:"success", time:400, width:340, height:900)
    ]
    private let reducedFrames = [
        Frame(name:"reduced-working", pose:"working", time:600),
        Frame(name:"reduced-success", pose:"success", time:400),
        Frame(name:"reduced-idle-340", pose:"idle", time:0, width:340, height:900)
    ]

    func start(root: URL, output: URL) throws {
        self.root = root
        self.output = output
        try FileManager.default.createDirectory(at:output, withIntermediateDirectories:true)
        load(reduced:false)
    }

    private func load(reduced: Bool) {
        self.reduced = reduced
        index = 0
        readinessAttempts = 0
        let configuration = WKWebViewConfiguration()
        var setup = "window.__motionErrors=[];addEventListener('error',event=>window.__motionErrors.push(event.message));addEventListener('unhandledrejection',event=>window.__motionErrors.push(String(event.reason)));"
        if reduced {
            setup += #"""
            const originalMatchMedia=window.matchMedia.bind(window);
            window.matchMedia=query=>query.includes('prefers-reduced-motion')?{matches:true,media:query,onchange:null,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){},dispatchEvent(){return true;}}:originalMatchMedia(query);
            """#
        }
        configuration.userContentController.addUserScript(WKUserScript(source:setup, injectionTime:.atDocumentStart, forMainFrameOnly:true))
        webView = WKWebView(frame:NSRect(x:0,y:0,width:1024,height:1000), configuration:configuration)
        webView.navigationDelegate = self
        let panel = NSPanel(contentRect:webView.frame, styleMask:[.borderless,.nonactivatingPanel], backing:.buffered, defer:false)
        panel.hidesOnDeactivate = false
        panel.ignoresMouseEvents = true
        window = panel
        window.contentView = webView
        webView.loadFileURL(root.appendingPathComponent("companion-motion-preview.html"), allowingReadAccessTo:root)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { waitForAssets() }

    private func waitForAssets() {
        readinessAttempts += 1
        webView.evaluateJavaScript(#"""
        (()=>{
          if(!window.TuotieMotionPreview)return false;
          TuotieMotionPreview.pause();
          const images=[...document.images];
          return images.length>=20&&images.every(image=>image.complete&&image.naturalWidth>0&&image.naturalHeight>0);
        })()
        """#) { value,error in
            if let error { self.complete("Asset readiness: \(error)"); return }
            if value as? Bool == true { self.checkNext(); return }
            guard self.readinessAttempts < 100 else { self.complete("Companion SVG assets did not finish loading"); return }
            DispatchQueue.main.asyncAfter(deadline:.now()+0.05) { self.waitForAssets() }
        }
    }

    private func checkNext() {
        let frames = reduced ? reducedFrames : normalFrames
        guard index < frames.count else {
            if !reduced { checkOffscreenSuspension(); return }
            finishReport(); return
        }
        let frame = frames[index]
        webView.setFrameSize(NSSize(width:frame.width,height:frame.height))
        window.setContentSize(NSSize(width:frame.width,height:frame.height))
        let script = "TuotieMotionPreview.setPose('\(frame.pose)');TuotieMotionPreview.seek(\(frame.time));window.dispatchEvent(new Event('resize'));"
        webView.evaluateJavaScript(script) { _,error in
            if let error { self.complete("Seek \(frame.name): \(error)"); return }
            // WebKit must commit paused WAAPI presentation before measuring it.
            DispatchQueue.main.asyncAfter(deadline:.now()+0.07) { self.measure(frame) }
        }
    }

    private func measure(_ frame: Frame) {
        let script = #"""
        (()=>{
          const assert=(value,message)=>{if(!value)throw Error(message);};
          const rect=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
          const actual=document.getElementById('mpActual'),large=document.getElementById('mpLarge');
          const box=rect(actual),actualFrame=rect(document.getElementById('mpActualMount'));
          assert(Math.abs(box.width-48)<.05&&Math.abs(box.height-48)<.05,'Actual component is not 48 pt');
          assert(document.documentElement.scrollWidth<=innerWidth+1,'Horizontal overflow at '+innerWidth);
          const images=[...document.images];
          assert(images.length>=20&&images.every(image=>image.complete&&image.naturalWidth>0&&image.naturalHeight>0),'SVG asset has zero natural dimensions');
          const visible=image=>{
            for(let element=image;element&&element!==actual;element=element.parentElement){const css=getComputedStyle(element);if(css.visibility==='hidden'||css.display==='none'||Number(css.opacity)<.001)return false;}
            return true;
          };
          const visibleRects=[...actual.querySelectorAll('img')].filter(visible).map(rect);
          const wink=actual.dataset.companionPose==='received';
          assert(visibleRects.length>=(wink?1:actual.dataset.companionPose==='working'?2:3),'Character is incomplete');
          for(const r of visibleRects)assert(r.x>=actualFrame.x-1&&r.right<=actualFrame.right+1&&r.y>=actualFrame.y-1&&r.bottom<=actualFrame.bottom+1,'Visible prop escapes actual-size review frame');
          const values=root=>[...root.querySelectorAll('.companion-body,.companion-face,.companion-gaze,.companion-eyes,.companion-base,.companion-wink,.companion-prop')].map(element=>{
            const style=getComputedStyle(element);return [element.className,style.transform.replace(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi,n=>String(Math.round(Number(n)*10000)/10000)),style.opacity,style.visibility];
          });
          const largeSignature=JSON.stringify(values(large)),actualSignature=JSON.stringify(values(actual));
          assert(largeSignature===actualSignature,'Two sizes differ beyond 0.0001 in transform components');
          assert(window.__motionErrors.length===0,'Console errors: '+window.__motionErrors.join('; '));
          const state=TuotieMotionPreview.state();
          if(state.reduced){
            assert(!state.playing&&state.time===state.duration,'Reduced motion is not a complete static end frame');
            assert(document.getAnimations().every(animation=>animation.playState!=='running'),'Reduced motion still has running animations');
          }
          return {state,signature:actualSignature,actualBounds:box,visibleBounds:visibleRects,viewport:{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth},assets:images.slice(0,11).map(image=>({file:image.src.split('/').pop(),width:image.naturalWidth,height:image.naturalHeight})),animationCount:document.getAnimations().length};
        })()
        """#
        webView.evaluateJavaScript(script) { value,error in
            if let error { self.complete("Frame \(frame.name): \((error as NSError).userInfo)"); return }
            guard var record=value as? [String:Any],let signature=record["signature"] as? String else { self.complete("Missing frame metrics"); return }
            record["name"] = frame.name
            self.records.append(record)
            let key="\(frame.pose)-\(frame.time)-\(self.reduced)"
            if let previous=self.signatures[key],previous != signature { self.complete("Non-deterministic fixed frame: \(frame.name)"); return }
            self.signatures[key]=signature
            if !self.reduced && frame.pose == "working" {
                if frame.time == 0 { self.firstWork=signature }
                if frame.time == 2400 && self.firstWork != signature { self.complete("Working loop has a discontinuous boundary"); return }
            }
            if !self.reduced && frame.pose == "success",let state=record["state"] as? [String:Any],state["time"] as? Int != frame.time { self.complete("Success seek time was not retained"); return }
            self.snapshot(frame)
        }
    }

    private func snapshot(_ frame: Frame) {
        webView.takeSnapshot(with:nil) { image,error in
            if let error { self.complete("Snapshot \(frame.name): \(error)"); return }
            guard let tiff=image?.tiffRepresentation,let bitmap=NSBitmapImageRep(data:tiff),let png=bitmap.representation(using:.png,properties:[:]) else { self.complete("No PNG snapshot: \(frame.name)"); return }
            do { try png.write(to:self.output.appendingPathComponent(frame.name+".png")) }
            catch { self.complete("Cannot write snapshot: \(error)"); return }
            print("Companion WebKit: \(frame.name), \(Int(frame.width)) pt, assets and shared frame passed")
            self.index += 1
            self.checkNext()
        }
    }

    private func checkOffscreenSuspension() {
        window.orderFrontRegardless()
        DispatchQueue.main.asyncAfter(deadline:.now()+0.10) { self.startOffscreenSuspension() }
    }

    private func startOffscreenSuspension() {
        webView.evaluateJavaScript(#"""
        document.body.style.paddingBottom='1400px';TuotieMotionPreview.setPose('working');TuotieMotionPreview.seek(600);TuotieMotionPreview.play();window.scrollTo(0,900);
        """#) { _,error in
            if let error { self.complete("Offscreen setup: \(error)"); return }
            DispatchQueue.main.asyncAfter(deadline:.now()+0.09) {
                self.webView.evaluateJavaScript(#"""
                (()=>{const state=TuotieMotionPreview.state();if(!state.suspended)throw Error('Offscreen preview was not suspended');window.__offscreenTime=state.time;return state;})()
                """#) { _,error in
                    if let error { self.complete("Offscreen observation: \((error as NSError).userInfo)"); return }
                    DispatchQueue.main.asyncAfter(deadline:.now()+0.28) {
                        self.webView.evaluateJavaScript(#"""
                        (()=>{const state=TuotieMotionPreview.state();if(state.time!==window.__offscreenTime)throw Error('Offscreen preview continued playing');window.scrollTo(0,0);document.body.style.paddingBottom='';return state;})()
                        """#) { _,error in
                            if let error { self.complete("Offscreen pause: \((error as NSError).userInfo)"); return }
                            DispatchQueue.main.asyncAfter(deadline:.now()+0.07) {
                                self.webView.evaluateJavaScript(#"""
                                (()=>{const state=TuotieMotionPreview.state();TuotieMotionPreview.pause();if(state.time<=window.__offscreenTime||state.time-window.__offscreenTime>160)throw Error('Returning preview failed to resume from its frozen offscreen frame');return state;})()
                                """#) { value,error in
                                    if let error { self.complete("Offscreen resume: \((error as NSError).userInfo)"); return }
                                    self.records.append(["name":"offscreen-no-catch-up","state":value ?? [:]])
                                    print("Companion WebKit: offscreen clock pauses and resumes without catch-up")
                                    self.checkClockSuspension()
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private func checkClockSuspension() {
        // Visibility is simulated only inside this isolated WKWebView. Waiting
        // while hidden must preserve the frame instead of catching up on return.
        webView.evaluateJavaScript(#"""
        TuotieMotionPreview.setPose('working');TuotieMotionPreview.seek(600);TuotieMotionPreview.play();
        window.__motionTestHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__motionTestHidden});
        document.dispatchEvent(new Event('visibilitychange'));
        """#) { _,error in
            if let error { self.complete("Visibility setup: \(error)"); return }
            DispatchQueue.main.asyncAfter(deadline:.now()+0.28) {
                self.webView.evaluateJavaScript(#"""
                (()=>{
                  const hidden=TuotieMotionPreview.state();
                  if(hidden.time!==600||!hidden.suspended)throw Error('Hidden preview clock continued');
                  window.__motionTestHidden=false;document.dispatchEvent(new Event('visibilitychange'));
                  return hidden;
                })()
                """#) { _,error in
                    if let error { self.complete("Visibility pause: \((error as NSError).userInfo)"); return }
                    DispatchQueue.main.asyncAfter(deadline:.now()+0.07) {
                        self.webView.evaluateJavaScript(#"""
                        (()=>{const state=TuotieMotionPreview.state();TuotieMotionPreview.pause();if(state.time<=600||state.time>760)throw Error('Returning preview failed to resume from its frozen hidden frame');return state;})()
                        """#) { value,error in
                            if let error { self.complete("Visibility resume: \((error as NSError).userInfo)"); return }
                            self.records.append(["name":"visibility-no-catch-up","state":value ?? [:]])
                            print("Companion WebKit: hidden clock pauses and resumes without catch-up")
                            self.checkEngineAutoplay()
                        }
                    }
                }
            }
        }
    }

    private func checkEngineAutoplay() {
        // Bypass the preview's deterministic seek clock here: this verifies the
        // actual dock engine's IO/WAAPI playback in real WebKit. WebKit freezes
        // document.timeline in an unordered window; show this isolated panel
        // without activation or mouse interception for the brief playback check.
        window.orderFrontRegardless()
        // Let AppKit commit the visible window and refresh document.timeline
        // before asking the engine to establish its animation startTime.
        DispatchQueue.main.asyncAfter(deadline:.now()+0.10) { self.startEngineAutoplay() }
    }

    private func startEngineAutoplay() {
        webView.evaluateJavaScript(#"""
        (()=>{
          TuotieMotionPreview.pause();
          const root=document.getElementById('mpLarge'),outer=root.parentElement;
          window.__engineAutoplay={root,outer,oldRoot:root.style.transform,oldOuter:outer.style.transform};
          root.style.transform='translate(3px, -2px)';outer.style.transform='translate(13px, -7px) rotate(2deg)';
          __engineAutoplay.rootTransform=root.style.transform;__engineAutoplay.outerTransform=outer.style.transform;
          __engineAutoplay.working=TuotieCompanionMotion.setPose(root,'working',{eventKey:'webkit-working-autoplay',animate:true});
        })()
        """#) { _,error in
            if let error { self.complete("Engine autoplay setup: \(error)"); return }
            DispatchQueue.main.asyncAfter(deadline:.now()+0.18) {
                self.webView.evaluateJavaScript(#"""
                (()=>{
                  const test=__engineAutoplay,root=test.root,controller=test.working;
                  const animations=document.getAnimations().filter(animation=>root.contains(animation.effect.target));
                  if(!controller.playing||root.dataset.companionMotion!=='running')throw Error('Working engine did not enter running state');
                  if(animations.length<3||animations.some(animation=>animation.playState!=='running'||animation.currentTime<=30||animation.currentTime>1000))throw Error('Real working WAAPI time did not advance from its live start: '+JSON.stringify({timeline:document.timeline.currentTime,controllerTime:controller.currentTime,animations:animations.map(animation=>({state:animation.playState,pending:animation.pending,time:animation.currentTime,start:animation.startTime}))}));
                  if(root.style.transform!==test.rootTransform||test.outer.style.transform!==test.outerTransform)throw Error('Character motion changed the outer dock transform');
                  const result={playing:controller.playing,phase:root.dataset.companionMotion,animationCount:animations.length,currentTimes:animations.map(animation=>Math.round(animation.currentTime)),outerTransformPreserved:true};
                  test.success=TuotieCompanionMotion.setPose(root,'success',{eventKey:'webkit-success-autoplay',animate:true});
                  return result;
                })()
                """#) { value,error in
                    if let error { self.complete("Working autoplay: \((error as NSError).userInfo)"); return }
                    self.records.append(["name":"engine-working-autoplay","result":value ?? [:]])
                    DispatchQueue.main.asyncAfter(deadline:.now()+1.65) { self.checkSuccessAutoplayCompletion() }
                }
            }
        }
    }

    private func checkSuccessAutoplayCompletion() {
        webView.evaluateJavaScript(#"""
        (()=>{
          const test=__engineAutoplay,root=test.root,controller=test.success;
          const animations=document.getAnimations().filter(animation=>root.contains(animation.effect.target));
          if(controller.playing||root.dataset.companionMotion!=='complete'||controller.currentTime!==1450)throw Error('Real success playback did not complete once');
          if(animations.length<4||animations.some(animation=>animation.playState==='running'||animation.currentTime!==1450))throw Error('Success layers did not settle together');
          test.completedAnimations=animations;
          const same=TuotieCompanionMotion.setPose(root,'success',{eventKey:'webkit-success-autoplay',animate:true});
          if(same!==controller||same.currentTime!==1450||same.playing)throw Error('Same eventKey restarted completed success');
          return {complete:true,currentTime:controller.currentTime,animationCount:animations.length};
        })()
        """#) { _,error in
            if let error { self.complete("Success autoplay completion: \((error as NSError).userInfo)"); return }
            DispatchQueue.main.asyncAfter(deadline:.now()+0.12) {
                self.webView.evaluateJavaScript(#"""
                (()=>{
                  const test=__engineAutoplay,root=test.root,controller=test.success;
                  const animations=document.getAnimations().filter(animation=>root.contains(animation.effect.target));
                  if(controller.playing||controller.currentTime!==1450||root.dataset.companionMotion!=='complete'||animations.some((animation,index)=>animation!==test.completedAnimations[index]||animation.currentTime!==1450))throw Error('Completed success replayed after repeated state');
                  if(root.style.transform!==test.rootTransform||test.outer.style.transform!==test.outerTransform)throw Error('Success motion changed the outer dock transform');
                  const result={complete:true,currentTime:controller.currentTime,sameEventKeyReplayed:false,outerTransformPreserved:true};
                  TuotieCompanionMotion.dispose(root);root.style.transform=test.oldRoot;test.outer.style.transform=test.oldOuter;
                  return result;
                })()
                """#) { value,error in
                    if let error { self.complete("Success eventKey stability: \((error as NSError).userInfo)"); return }
                    self.records.append(["name":"engine-success-autoplay-once","result":value ?? [:]])
                    print("Companion WebKit: real working WAAPI advances; success completes once, repeated eventKey and outer transforms stay stable")
                    self.window.close()
                    self.load(reduced:true)
                }
            }
        }
    }

    private func finishReport() {
        do {
            let data=try JSONSerialization.data(withJSONObject:["frames":records,"checks":["real SVG dimensions","shared deterministic seek","loop boundary","48 pt component bounds","390/340 pt no overflow","reduced complete static poses","hidden no catch-up","offscreen no catch-up","real WAAPI working autoplay","success completes once without same-event replay","outer dock transform preserved"]], options:[.prettyPrinted,.sortedKeys])
            try data.write(to:output.appendingPathComponent("report.json"))
            print("Companion motion visual checks passed; \(normalFrames.count+reducedFrames.count) review frames saved to \(output.path)")
            complete(nil)
        } catch { complete("Cannot write report: \(error)") }
    }

    private func complete(_ error: String?) { failure=error;finished=true }
}

@main struct CompanionMotionVisualTests {
    static func main() throws {
        let application=NSApplication.shared
        application.setActivationPolicy(.accessory)
        application.finishLaunching()
        let check=CompanionMotionVisualCheck()
        let root=URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true)
        let output=CommandLine.arguments.count>2 ? URL(fileURLWithPath:CommandLine.arguments[2],isDirectory:true) : root.appendingPathComponent(".local/companion-motion-check",isDirectory:true)
        try check.start(root:root,output:output)
        let deadline=Date().addingTimeInterval(40)
        while !check.finished && Date()<deadline {
            if let event=application.nextEvent(matching:.any,until:Date().addingTimeInterval(0.02),inMode:.default,dequeue:true) { application.sendEvent(event) }
            application.updateWindows()
        }
        if let error=check.failure { fputs(error+"\n",stderr);exit(1) }
        guard check.finished else { fputs("Companion motion WebKit check timed out\n",stderr);exit(1) }
    }
}
