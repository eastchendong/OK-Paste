import AppKit
import WebKit

// Exercise real WebKit sizing and the geometry consumed by AppKit, without
// changing the running app, the user's package, or the system clipboard.
final class CollectionLayoutCheck: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    var finished = false
    var failure: String?
    private var geometry: [[String: Double]] = []
    private var webView: WKWebView!
    private var window: NSWindow!

    func start(root: URL) throws {
        let controller = WKUserContentController()
        controller.add(self, name: "tuotie")
        for name in ["desktop-overlay.js", "desktop-live.js"] {
            let script = try String(contentsOf: root.appendingPathComponent("desktop-preview/" + name), encoding: .utf8)
            controller.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1024, height: 768), configuration: configuration)
        webView.navigationDelegate = self
        window = NSWindow(contentRect: webView.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = webView
        webView.loadFileURL(root.appendingPathComponent("components-preview.html"), allowingReadAccessTo: root)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let value = message.body as? [String: Any], value["type"] as? String == "geometry" else { return }
        geometry = value["regions"] as? [[String: Double]] ?? []
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let script = #"""
        window.matchMedia = () => ({matches:true});
        const preview=document.createElement('canvas');preview.width=120;preview.height=60;
        const paint=preview.getContext('2d');paint.fillStyle='#8dbcd0';paint.fillRect(0,0,120,60);
        TuotieDesktopLive.apply({items:Array.from({length:8},(_,i)=>({
          id:'layout-'+i,type:i===6?'table':i===7?'image':'text',
          source:{appName:'Google Chrome',title:'妥帖合成测试内容 '+i,url:'https://example.org/'+ 'long-path/'.repeat(30)},
          preview:i===7?preview.toDataURL():'',
          body:i===6?{rows:[['项目','数量'],['访谈','137'],['问卷','222']]}:{text:'用于程序运行演示与交互研究，记录内容在不同应用之间流动时的真实需求。'.repeat(5)}
        })),agent:{phase:'ready',destinationId:'system'}});
        document.querySelector('#dockBot').click();
        """#
        webView.evaluateJavaScript(script) { _, error in
            if let error { self.complete(String(describing:(error as NSError).userInfo)); return }
            self.check(width: 1024, scrolled: false) {
                self.checkHover {
                    self.check(width: 360, scrolled: false) {
                        self.check(width: 360, scrolled: true) { self.checkPaste() }
                    }
                }
            }
        }
    }

    private func checkHover(next: @escaping () -> Void) {
        let script = #"""
        const row=document.querySelector('#bundleBody .bundle-card');
        const text=row.querySelector('.collection-preview-text');
        if(Math.abs(row.getBoundingClientRect().height-34)>1)throw Error('Text row is not compact');
        if(text.scrollWidth<=text.clientWidth||getComputedStyle(text).textOverflow!=='ellipsis')throw Error('Long content does not ellipsize');
        if(getComputedStyle(row.querySelector('.bundle-card-copy')).display!=='none')throw Error('Metadata leaked into default row');
        for(const media of document.querySelectorAll('#bundleBody [data-kind="image"],#bundleBody [data-kind="table"]')) {
          if(Math.abs(media.getBoundingClientRect().height-62)>1)throw Error('Media row is not compact');
        }
        const table=document.querySelector('.collection-row-content table');
        if(!table.textContent.includes('137')||table.getBoundingClientRect().height>46)throw Error('Real table preview is missing or too large');
        const image=document.querySelector('.collection-row-content img'),imageRect=image.getBoundingClientRect();
        if(!image.complete||image.naturalWidth!==120||imageRect.height>46||Math.abs(imageRect.width/imageRect.height-2)>.01)throw Error('Image preview is missing or stretched');
        row.dispatchEvent(new MouseEvent('pointerover',{bubbles:true}));
        """#
        webView.evaluateJavaScript("(()=>{" + script + "})()") { _, error in
            if let error { self.complete(String(describing:(error as NSError).userInfo)); return }
            DispatchQueue.main.asyncAfter(deadline:.now()+0.35) {
                self.webView.evaluateJavaScript(#"""
                (()=>{
                  const panel=document.querySelector('#collectionHover'),row=document.querySelector('.collection-hovered');
                  const r=panel.getBoundingClientRect(),a=row?.getBoundingClientRect();
                  if(panel.hidden||!a||r.left<a.right||r.right>innerWidth)throw Error('Popover must sit outside the list without being clipped');
                  const link=panel.querySelector('.origin-link'),hit=link.getBoundingClientRect();
                  const e=document.elementFromPoint(hit.left+5,hit.top+5);
                  if(!link.contains(e))throw Error('Source link cannot receive pointer input');
                  return {x:hit.left+5,y:hit.top+5};
                })()
                """#) { result, error in
                    if let error { self.complete(String(describing:(error as NSError).userInfo)); return }
                    guard let point=result as? [String:Double], self.geometry.contains(where: { self.rect($0).contains(CGPoint(x:point["x"]!,y:point["y"]!)) }) else {
                        self.complete("Hover link missing from native hit regions"); return
                    }
                    print("Collection WebKit hover: single-line truncation, separate popover and clickable source passed")
                    guard CommandLine.arguments.count>2 else { next(); return }
                    self.webView.takeSnapshot(with:nil) { image,error in
                        if let image,let tiff=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:tiff),let png=bitmap.representation(using:.png,properties:[:]) {
                            try? png.write(to:URL(fileURLWithPath:CommandLine.arguments[2]))
                        }
                        next()
                    }
                }
            }
        }
    }

    private func check(width: CGFloat, scrolled: Bool, next: @escaping () -> Void) {
        webView.setFrameSize(NSSize(width: width, height: 768))
        let script = """
        window.dispatchEvent(new Event('resize'));
        const body=document.querySelector('#bundleBody');
        body.scrollTop=\(scrolled ? "body.scrollHeight" : "0");
        window.dispatchEvent(new Event('resize'));
        const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
        return ({stack:rect(document.querySelector('#bundleStack')),bundle:rect(document.querySelector('#bundle')),
          viewport:rect(body),buttons:[...body.querySelectorAll('[data-remove]')].map(rect)});
        """
        // Each evaluation gets its own scope, like a small renderer test case.
        webView.evaluateJavaScript("(()=>{" + script + "})()") { result, error in
            if let error { self.complete(String(describing:(error as NSError).userInfo)); return }
            guard let data = result as? [String: Any], let stack = data["stack"] as? [String: Double],
                  let bundle = data["bundle"] as? [String: Double], let viewport = data["viewport"] as? [String: Double],
                  let buttons = data["buttons"] as? [[String: Double]] else {
                self.complete("Missing layout measurements"); return
            }
            guard bundle["width"]! <= stack["width"]! + 1 else {
                self.complete("Long titles expanded the card to \(bundle["width"]!) outside its \(stack["width"]!)-point container"); return
            }
            var checked = 0
            for button in buttons {
                let point = CGPoint(x: button["x"]! + button["width"]! / 2, y: button["y"]! + button["height"]! / 2)
                let clip = self.rect(viewport)
                if !clip.contains(point) { continue }
                guard self.geometry.contains(where: { self.rect($0).contains(point) }) else {
                    self.complete("Visible delete button at \(point) falls through the native hit regions"); return
                }
                checked += 1
            }
            guard checked > 0 else { self.complete("No visible delete buttons checked"); return }
            print("Collection WebKit layout: width=\(Int(width)), scrolled=\(scrolled), \(checked) delete buttons covered")
            next()
        }
    }

    private func checkPaste() {
        webView.setFrameSize(NSSize(width: 1024, height: 768))
        let script = #"""
        const items=Array.from({length:5},(_,i)=>({id:'paste-'+i,type:'text',body:{text:'原始参考资料 '+i}}));
        const agent={phase:'ready',destinationId:'office',targetKind:'word-live',targetName:'隔离测试文稿',plannedSourceIds:items.map(i=>i.id),actions:['结合当前位置补充一段研究结论，并保留上下文的语气与事实限定']};
        TuotieDesktopLive.apply({items,agent});
        TuotieDesktopLive.openWordPaste({x:950,y:700,exact:true});
        const box=id=>document.getElementById(id).getBoundingClientRect();
        const near=(a,b)=>Math.abs(a-b)<1;
        const bounds=()=>{
          const host=box('officePastePanel');
          if(host.left<11||host.right>innerWidth-11||host.top<11||host.bottom>innerHeight-11)throw Error('Paste host escapes viewport: '+JSON.stringify(host));
        };
        const aligned=()=>{
          const pet=box('dockPet'),content=box('bundleStack'),task=box('taskPanel'),intent=box('intentPanel');
          const top=document.getElementById('intentPanel').hidden?task:intent;
          if(!near(pet.top,top.top)||!near(content.left,top.left)||content.top<top.bottom)throw Error('IP, composer and collection are not aligned: '+JSON.stringify({pet,content,top}));
        };
        aligned();bounds();
        const editor=document.querySelector('#intentInput');
        document.querySelector('#dockBot').click();
        if(!near(box('officePastePanel').width,48)||box('intentPanel').height||box('bundleStack').height)throw Error('Folded task still covers document');
        document.querySelector('#dockBot').click();
        aligned();bounds();
        if(editor.scrollWidth>editor.clientWidth+1)throw Error('Default recommendation overflows input');
        document.querySelector('[data-start]').click();
        if(!document.querySelector('#bundleStack').hidden||box('taskPanel').height>50)throw Error('Processing is not compact');
        const done={...agent,phase:'done',canUndo:true,result:'已写入。'};
        TuotieDesktopLive.apply({items,agent:done});
        TuotieUI.dispatch({type:'generation/finish',text:'已写入。'});
        aligned();bounds();
        if(!document.querySelector('#followupInput')||!document.querySelector('[data-undo]'))throw Error('Missing immediate adjustments or undo');
        const edges=[...document.querySelectorAll('#taskPanel .composer,#taskPanel .completion-header')].map(e=>e.getBoundingClientRect());
        if(edges.some(e=>!near(e.left,box('bundleStack').left)||!near(e.width,box('bundleStack').width)))throw Error('Result surfaces differ from source width');
        return 'Paste WebKit: one recommendation, compact processing, aligned result and collection, viewport bounds passed';
        """#
        webView.evaluateJavaScript("(()=>{"+script+"})()") { result,error in
            if let error { self.complete(String(describing:(error as NSError).userInfo)); return }
            print(result as? String ?? "Paste layout check completed")
            guard CommandLine.arguments.count>2 else { self.checkBlender(); return }
            self.webView.takeSnapshot(with:nil) { image,error in
                if let image,let tiff=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:tiff),let png=bitmap.representation(using:.png,properties:[:]) {
                    let output=URL(fileURLWithPath:CommandLine.arguments[2]).deletingPathExtension().appendingPathExtension("paste.png")
                    try? png.write(to:output)
                }
                self.complete(nil)
            }
        }
    }

    private func checkBlender() {
        let script = #"""
        TuotieDesktopLive.controlFinished('finish');
        const items=[{id:'blender-ref',type:'text',source:{title:'三维参考'},body:{text:'根据参考生成可编辑物体，保留已有场景。'}}];
        const agent={phase:'planning',destinationId:'blender',targetKind:'blender-scene',targetName:'Blender',plannedSourceIds:['blender-ref'],actions:[],pendingDrop:{eventId:'layout-frozen',summary:'桌面落点',placeable:true}};
        TuotieDesktopLive.apply({items,agent});
        if(TuotieOfficePaste.host!=='blender'||document.querySelector('#dropConfirm'))throw Error('Blender did not reuse the shared composer');
        const editor=document.querySelector('#intentInput');
        editor.textContent='参考这份资料，生成两个浅蓝色物体';editor.dispatchEvent(new Event('input',{bubbles:true}));
        TuotieDesktopLive.apply({items,agent:{...agent,phase:'ready',title:'在落点创建参考物体',actions:['在落点创建参考物体']}});
        if(document.querySelector('#intentInput').textContent!==editor.textContent)throw Error('Late recommendation overwrote the prompt');
        const r=document.querySelector('#intentPanel').getBoundingClientRect(),pet=document.querySelector('#dockPet').getBoundingClientRect(),bundle=document.querySelector('#bundleStack').getBoundingClientRect();
        if(Math.abs(r.top-pet.top)>1||Math.abs(r.left-bundle.left)>1||Math.abs(r.width-bundle.width)>1)throw Error('Blender composer diverged from the shared layout');
        document.querySelector('#intentPanel [data-start]').click();
        TuotieDesktopLive.apply({items,agent:{...agent,phase:'preview',pendingDrop:null,result:'预览已就绪',canUndo:false,changes:{added:['SyntheticObject'],modified:[],removed:[]}}});
        TuotieUI.dispatch({type:'generation/finish',text:'预览已就绪'});
        if(!document.querySelector('#followupInput')||document.querySelector('[data-accept]').textContent!=='应用')throw Error('Preview lost its adjustment or apply confirmation');
        return 'Blender WebKit: shared composer, draft protection, aligned source layout and editable preview passed';
        """#
        webView.evaluateJavaScript("(()=>{"+script+"})()") { result,error in
            if let error { self.complete(String(describing:(error as NSError).userInfo)); return }
            print(result as? String ?? "Blender layout checked")
            self.webView.takeSnapshot(with:nil) { image,_ in
                if let image,let tiff=image.tiffRepresentation,let bitmap=NSBitmapImageRep(data:tiff),let png=bitmap.representation(using:.png,properties:[:]) {
                    let folder=FileManager.default.temporaryDirectory.appendingPathComponent("tuotie-blender-ui-check")
                    try? FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
                    try? png.write(to:folder.appendingPathComponent("blender-preview.png"))
                }
                self.TidyBlenderLayoutCheck()
            }
        }
    }
    private func TidyBlenderLayoutCheck() {
        webView.evaluateJavaScript("TuotieDesktopLive.controlFinished('finish')") { _,_ in self.checkPetTravel() }
    }

    private func checkPetTravel() {
        let script = #"""
        const pet=document.getElementById('dockBot');
        const travel=()=>pet.getAnimations().find(animation=>animation.id==='pet-travel');
        const pos=()=>pet.getBoundingClientRect();
        const distance=(a,b)=>Math.hypot(a.left-b.left,a.top-b.top);
        const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
        TuotieDesktopLive.controlFinished('finish');
        await tick();
        const home=pos();
        if(travel()) throw Error('Reduced motion started a flight');
        window.matchMedia=()=>({matches:false});
        TuotieDesktopLive.openWordPaste({x:550,y:280,exact:true});
        await tick();
        const flight=travel();
        if(!flight || distance(pos(),home)>30) throw Error('Companion jumped on opening');
        flight.currentTime=flight.effect.getTiming().duration * .55;
        await tick();
        const middle=pos();
        if(distance(middle,home)<50) throw Error('Companion never left home');
        TuotieDesktopLive.controlFinished('finish');
        await tick();
        const returning=travel();
        if(!returning || returning===flight || distance(pos(),middle)>45) throw Error('Interrupted return jumped: '+JSON.stringify({middle,now:pos(),home,returning:!!returning,same:returning===flight}));
        returning.finish();
        await tick();
        if(distance(pos(),home)>2) throw Error('Return missed original docking position');
        return 'Companion travel: reduced motion, launch, interrupted return and docking passed';
        """#
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value): print(value); self.complete(nil)
            case .failure(let error): self.complete(String(describing:(error as NSError).userInfo))
            }
        }
    }

    private func rect(_ value: [String: Double]) -> CGRect {
        CGRect(x: value["x"]!, y: value["y"]!, width: value["width"]!, height: value["height"]!)
    }

    private func complete(_ error: String?) { failure = error; finished = true }
}

@main struct CollectionLayoutTests {
    static func main() throws {
        _ = NSApplication.shared
        let check = CollectionLayoutCheck()
        try check.start(root: URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true))
        let deadline = Date().addingTimeInterval(20)
        while !check.finished && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.02)) }
        if let error = check.failure { fputs(error + "\n", stderr); exit(1) }
        guard check.finished else { fputs("WebKit layout check timed out\n", stderr); exit(1) }
    }
}
