import AppKit
import WebKit

// An isolated WebKit checks the actual dock and generated overlay together.
// Synthetic Office/drag state stays in this view; no clipboard or native input.
final class CompanionEdgeCheck: NSObject, WKNavigationDelegate {
    var finished = false
    var failure: String?
    private var webView: WKWebView!
    private var window: NSWindow!

    func start(root: URL) throws {
        let configuration = WKWebViewConfiguration()
        for name in ["desktop-overlay.js", "desktop-live.js"] {
            let source = try String(contentsOf: root.appendingPathComponent("desktop-preview/" + name), encoding: .utf8)
            configuration.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1024, height: 768), configuration: configuration)
        webView.navigationDelegate = self
        window = NSWindow(contentRect: webView.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = webView
        webView.loadFileURL(root.appendingPathComponent("components-preview.html"), allowingReadAccessTo: root)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task {
            do {
                let result = try await webView.callAsyncJavaScript(Self.check, arguments: [:], in: nil, contentWorld: .page)
                print(result as? String ?? "Companion edge checks passed")
            } catch { failure = String(describing: (error as NSError).userInfo) }
            finished = true
        }
    }

    private static let check = #"""
    const assert=(value,message)=>{if(!value)throw Error(message);};
    const wait=()=>new Promise(resolve=>setTimeout(resolve,70));
    const rect=element=>element.getBoundingClientRect();
    const dock=document.getElementById('dock');
    for(let attempt=0;attempt<40&&[...document.images].some(image=>!image.complete||!image.naturalWidth);attempt++)await wait();
    assert([...document.images].every(image=>image.complete&&image.naturalWidth),'Character assets did not load');

    // Start at the existing 12 pt drag limit. Completed-task layout must supply
    // the extra room for the real 52 pt button and the growing Figma burst.
    state.phase='done';state.generated='隔离边缘检查';state.petCollapsed=false;state.collapsed=false;
    dockMoved=true;dock.style.left=`${innerWidth-60}px`;dock.style.top='12px';
    dock.style.bottom='auto';dock.style.transition='none';render();await wait();
    const root=document.getElementById('dockOrb'),frames=[];
    assert(Math.abs(rect(dock).right-(innerWidth-14))<.05,'Completed dock lost its 14 pt right margin');
    for(const time of [850,950]) {
      TuotieCompanionMotion.seek(root,'success',time);await wait();
      const visible=[...root.querySelectorAll('img')].filter(image=>{
        let opacity=1;
        for(let node=image;node;node=node.parentElement){
          const style=getComputedStyle(node);opacity*=Number(style.opacity);
          if(style.display==='none'||style.visibility==='hidden')return false;
          if(node===root)break;
        }
        return opacity>.05;
      });
      const burst=root.querySelector('.companion-sparkle-right');
      assert(Number(getComputedStyle(burst).opacity)>.05,`Star is not visible at ${time} ms`);
      const right=Math.max(...visible.map(image=>rect(image).right));
      assert(right<=innerWidth+.01,`Visible celebration clips at ${time} ms: ${right}>${innerWidth}`);
      frames.push(`${time}ms=${right.toFixed(3)}pt`);
    }

    // Office continues to use its existing 12 pt host margin and 64 pt content
    // column. Celebration correction must not move this separate grid.
    const items=[{id:'companion-edge-source',type:'text',body:{text:'隔离 Office 内容'}}];
    TuotieDesktopLive.apply({items,agent:{phase:'ready',destinationId:'office',targetKind:'word-live',targetName:'隔离测试文稿',plannedSourceIds:items.map(item=>item.id)}});
    TuotieDesktopLive.openWordPaste({x:950,y:12,exact:true});
    const host=document.getElementById('officePastePanel');
    state.phase='done';state.generated='隔离 Office 完成';render();await wait();
    host.style.left=`${innerWidth-rect(host).width-12}px`;host.style.top='12px';
    const officeLeft=rect(host).left;
    render();window.dispatchEvent(new Event('resize'));await wait();
    assert(Math.abs(rect(host).left-officeLeft)<.05&&Math.abs(rect(host).right-(innerWidth-12))<.05,'Celebration changed Office host placement');
    assert(Math.abs(rect(dock).left-rect(host).left)<.05,'Office dock left the first grid column');
    assert(Math.abs(rect(document.getElementById('taskPanel')).left-rect(host).left-64)<.05,'Office content column changed');

    // Keep the live flight at its established 12 pt destination while forcing
    // render/resize. positionTask must return before its completed-task clamp.
    document.body.append(dock);host.remove();TuotieOfficePaste.open=false;
    dock.style.left=`${innerWidth-60}px`;dock.style.top='100px';render();await wait();
    const sessionId='companion-edge-flight';
    assert(TuotiePackDrag.begin({sessionId}),'Could not begin isolated flight');
    assert(TuotiePackDrag.end({sessionId,accepted:true,x:innerWidth,y:160,fromX:innerWidth-60,fromY:100}),'Could not start isolated flight');
    render();window.dispatchEvent(new Event('resize'));await wait();
    assert(TuotiePackDrag.active()&&dock.dataset.packDrag==='flying','Flight was unexpectedly interrupted');
    assert(Math.abs(rect(dock).right-(innerWidth-12))<.05,'Completed-task correction moved an active flight');
    return `Companion edge WebKit: ${frames.join(', ')} inside 1024pt; Office 12pt/64pt grid and active flight preserved`;
    """#
}

@main struct CompanionEdgeTests {
    static func main() throws {
        _ = NSApplication.shared
        let check = CompanionEdgeCheck()
        try check.start(root: URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true))
        let deadline = Date().addingTimeInterval(20)
        while !check.finished && Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.02)) }
        if let failure = check.failure { fputs(failure + "\n", stderr); exit(1) }
        guard check.finished else { fputs("Companion edge WebKit check timed out\n", stderr); exit(1) }
    }
}
