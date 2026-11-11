import AppKit

// Floating controls must keep their material when the panel becomes key or
// loses focus. Liquid Glass has no public equivalent of the explicit active
// state below, so use AppKit's native frosted material for these backdrops.
enum NativeGlass {
    static func make() -> NSVisualEffectView {
        let view = NSVisualEffectView(frame: .zero)
        view.material = .popover
        view.blendingMode = .behindWindow
        view.state = .active
        view.isEmphasized = false
        // The shared component library uses a light surface and dark text.
        // Keep that appearance independent of the foreground app and theme.
        view.appearance = NSAppearance(named: .aqua)
        view.wantsLayer = true
        view.layer?.masksToBounds = true
        return view
    }

    static func setRadius(_ radius: CGFloat, on view: NSView) {
        view.layer?.cornerRadius = radius
    }

    // Cropping does not change the original corner radius. A short exposed
    // strip is the bottom of a card, never a newly rounded pill.
    static func setClipping(top: CGFloat, bottom: CGFloat, left: CGFloat, right: CGFloat, fadeBottom: CGFloat = 0, fadeBottomOffset: CGFloat = 0, on view: NSView) {
        guard let layer = view.layer else { return }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        guard top > 0 || bottom > 0 || left > 0 || right > 0 || fadeBottom > 0 else {
            layer.mask = nil; return
        }
        let mask = (layer.mask as? CAShapeLayer) ?? CAShapeLayer()
        mask.frame = view.bounds
        // AppKit layer coordinates start at the bottom, DOM coordinates at the top.
        mask.path = CGPath(rect: CGRect(x: left, y: bottom,
            width: max(0, view.bounds.width-left-right),
            height: max(0, view.bounds.height-top-bottom)), transform: nil)
        if fadeBottom > 0 && view.bounds.height > 0 {
            let gradient = (mask.mask as? CAGradientLayer) ?? CAGradientLayer()
            gradient.frame = view.bounds
            gradient.startPoint = CGPoint(x:0.5,y:0)
            gradient.endPoint = CGPoint(x:0.5,y:1)
            let height = view.bounds.height
            let positions: [CGFloat] = [0, max(0,min(height,fadeBottomOffset)), max(0,min(height,fadeBottomOffset+fadeBottom)), height]
            gradient.locations = positions.map { NSNumber(value:Double($0/height)) }
            gradient.colors = positions.map { position in
                NSColor.black.withAlphaComponent(max(0,min(1,(position-fadeBottomOffset)/fadeBottom))).cgColor
            }
            mask.mask = gradient
        } else { mask.mask = nil }
        layer.mask = mask
    }

}
