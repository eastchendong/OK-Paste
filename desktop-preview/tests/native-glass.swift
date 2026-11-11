import AppKit

// Check the real AppKit material's lifecycle contract. This does not claim
// pixel equivalence against a desktop captured behind another application.
@main struct NativeGlassTests {
    static func main() {
        _ = NSApplication.shared
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 480, height: 600), styleMask: [.borderless], backing: .buffered, defer: false)
        let root = NSView(frame: panel.contentRect(forFrameRect: panel.frame))
        panel.contentView = root
        let dimensions: [NSSize] = [.init(width: 240, height: 44), .init(width: 300, height: 49), .init(width: 300, height: 180)]
        let materials = dimensions.map { size -> NSVisualEffectView in
            let view = NativeGlass.make()
            view.frame = NSRect(origin: .zero, size: size)
            NativeGlass.setRadius(22, on: view)
            root.addSubview(view)
            return view
        }
        for appearance in [NSAppearance.Name.aqua, .darkAqua] {
            panel.appearance = NSAppearance(named: appearance)
            for notification in [NSWindow.didBecomeKeyNotification, NSWindow.didBecomeMainNotification, NSWindow.didResignKeyNotification, NSWindow.didResignMainNotification] {
                NotificationCenter.default.post(name: notification, object: panel)
                RunLoop.current.run(until: Date().addingTimeInterval(0.02))
                for view in materials {
                    precondition(view.state == .active, "The backdrop must not follow window activation")
                    precondition(view.blendingMode == .behindWindow, "The backdrop must sample the real desktop")
                    precondition(view.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .aqua, "The light component surface must not change with the containing window")
                    precondition(!view.isEmphasized)
                    precondition(view.layer?.cornerRadius == 22)
                }
            }
        }
        for view in materials {
            view.removeFromSuperview()
            view.frame.size.height += 30
            view.isHidden = true; root.addSubview(view); view.isHidden = false
            precondition(view.state == .active)
        }
        let clipped = NativeGlass.make()
        clipped.frame = NSRect(x:0,y:0,width:320,height:60)
        NativeGlass.setRadius(20,on:clipped)
        NativeGlass.setClipping(top:50,bottom:0,left:0,right:0,on:clipped)
        precondition(clipped.layer?.cornerRadius == 20, "A cropped card must retain its original corner")
        let mask = clipped.layer?.mask as! CAShapeLayer
        precondition(mask.path?.boundingBox == CGRect(x:0,y:0,width:320,height:10), "Bottom strip must clip in AppKit coordinates")
        NativeGlass.setClipping(top:0,bottom:12,left:2,right:3,on:clipped)
        precondition((clipped.layer?.mask as? CAShapeLayer)?.path?.boundingBox == CGRect(x:2,y:12,width:315,height:48))
        NativeGlass.setClipping(top:0,bottom:12,left:0,right:0,fadeBottom:32,fadeBottomOffset:12,on:clipped)
        let fade = clipped.layer?.mask?.mask as! CAGradientLayer
        precondition(fade.locations!.map { $0.doubleValue } == [0,0.2,44.0/60,1])
        precondition((fade.colors as! [CGColor]).map { $0.alpha } == [0,0,1,1])
        precondition(clipped.layer?.cornerRadius == 20)
        NativeGlass.setClipping(top:0,bottom:0,left:0,right:0,fadeBottom:32,fadeBottomOffset:-16,on:clipped)
        precondition(((clipped.layer?.mask?.mask as! CAGradientLayer).colors as! [CGColor]).first!.alpha == 0.5,"Cards ending inside the fade band share the same continuous gradient")
        NativeGlass.setClipping(top:10,bottom:0,left:0,right:0,on:clipped)
        precondition(clipped.layer?.mask?.mask == nil,"Scrolling to the end clears the fade while retaining any top clip")
        NativeGlass.setClipping(top:0,bottom:0,left:0,right:0,on:clipped)
        precondition(clipped.layer?.mask == nil, "Unfolding must remove the crop without changing the material")
        print("Native glass lifecycle: 3 sizes × 2 appearances × 4 activation notifications passed; detach / resize / reattach and rounded-card clipping passed.")
    }
}
