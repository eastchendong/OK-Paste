import AppKit

/// A shared, view-only result marker. Callers own target-app and task validation.
/// Frames and regions use global Cocoa points, including negative screen origins.
final class ResultOverlay {
    private(set) var panel: NSPanel?
    private(set) var currentID: String?
    private(set) var displayedRegions: [NSRect] = []
    private var timer: Timer?
    private var generation = 0

    /// Convert trusted top-left normalized client geometry to global Cocoa points.
    /// Pixel dimensions must agree with a 1x or the screen's actual backing scale;
    /// a modest title-bar inset is the only permitted difference in window height.
    static func normalizeToScreen(regions: [CGRect], windowFrame: CGRect,
                                  sourcePixelSize: CGSize, backingScale: CGFloat) -> [CGRect]? {
        guard valid(windowFrame), sourcePixelSize.width.isFinite, sourcePixelSize.height.isFinite,
              sourcePixelSize.width > 0, sourcePixelSize.height > 0,
              backingScale.isFinite, backingScale >= 1, backingScale <= 4 else { return nil }
        let scale = sourcePixelSize.width / windowFrame.width
        let close: (CGFloat) -> Bool = { abs(scale - $0) <= max(0.01, $0 * 0.01) }
        guard scale.isFinite, close(1) || close(backingScale) else { return nil }
        let contentHeight = sourcePixelSize.height / scale
        let titleTopInset = windowFrame.height - contentHeight
        guard contentHeight > 0, titleTopInset >= 0, titleTopInset <= 64 else { return nil }
        var mapped: [CGRect] = []
        for region in regions {
            guard valid(region), region.minX >= 0, region.minY >= 0,
                  region.maxX <= 1, region.maxY <= 1 else { return nil }
            mapped.append(CGRect(x: windowFrame.minX + region.minX * windowFrame.width,
                                 y: windowFrame.minY + (1 - region.maxY) * contentHeight,
                                 width: region.width * windowFrame.width,
                                 height: region.height * contentHeight))
        }
        return mapped
    }

    static func clippedRegions(_ regions: [NSRect], to screenFrame: NSRect) -> [NSRect] {
        guard valid(screenFrame) else { return [] }
        return regions.compactMap { region in
            guard valid(region) else { return nil }
            let clipped = region.intersection(screenFrame)
            return valid(clipped) ? clipped : nil
        }
    }

    private static func valid(_ rect: CGRect) -> Bool {
        rect.origin.x.isFinite && rect.origin.y.isFinite && rect.width.isFinite && rect.height.isFinite &&
        rect.width > 0 && rect.height > 0 && !rect.isNull && !rect.isInfinite
    }

    @discardableResult
    func show(id: String, screenFrame: NSRect, regions: [NSRect], label: String, duration: Double = 2.6) -> Bool {
        hide()
        guard !id.isEmpty, duration.isFinite, duration > 0 else { return false }
        let clipped = Self.clippedRegions(regions, to: screenFrame)
        guard !clipped.isEmpty else { return false }
        let window = ResultOverlayPanel(contentRect: screenFrame, styleMask: [.borderless, .nonactivatingPanel],
                                        backing: .buffered, defer: false)
        window.level = .statusBar
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.hidesOnDeactivate = false
        window.ignoresMouseEvents = true
        window.acceptsMouseMovedEvents = false
        window.animationBehavior = .none
        window.isReleasedWhenClosed = false
        let localRegions = clipped.map { $0.offsetBy(dx: -screenFrame.minX, dy: -screenFrame.minY) }
        let view = ResultOverlayView(regions: localRegions, label: label)
        view.frame = NSRect(origin: .zero, size: screenFrame.size)
        view.autoresizingMask = [.width, .height]
        window.contentView = view
        window.setFrame(screenFrame, display: true)
        panel = window
        currentID = id
        displayedRegions = clipped
        let token = generation
        window.orderFrontRegardless()
        view.startAnimation()
        let expiry = Timer(timeInterval: duration, repeats: false) { [weak self] _ in
            guard let self, self.generation == token else { return }
            self.hide()
        }
        timer = expiry
        RunLoop.main.add(expiry, forMode: .common)
        return true
    }

    func hide() {
        generation += 1
        timer?.invalidate()
        timer = nil
        panel?.orderOut(nil)
        panel?.close()
        panel = nil
        currentID = nil
        displayedRegions = []
    }

    deinit { timer?.invalidate(); panel?.orderOut(nil); panel?.close() }
}

private final class ResultOverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// No hit testing, event monitors, synthetic input, or system-cursor mutation.
private final class ResultOverlayView: NSView {
    let regions: [NSRect]
    let label: String
    private let accent = NSColor(calibratedRed: 0.58, green: 0.79, blue: 1, alpha: 0.98)
    private let palette = [NSColor(calibratedRed:0.58,green:0.79,blue:1,alpha:1), NSColor(calibratedRed:0.56,green:0.98,blue:0.91,alpha:1), NSColor(calibratedRed:1,green:0.9,blue:0.53,alpha:1)]
    private var animationTimer: Timer?
    private var startedAt = Date()
    var reviewTime: Double?
    private var time: Double { reviewTime ?? Date().timeIntervalSince(startedAt) }
    func startAnimation() {
        startedAt=Date()
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else{needsDisplay=true;return}
        animationTimer=Timer.scheduledTimer(withTimeInterval:1/60,repeats:true){[weak self] timer in
            guard let self,self.window != nil else{timer.invalidate();return}
            self.needsDisplay=true
        }
    }
    deinit {animationTimer?.invalidate()}
    override func viewDidMoveToWindow(){super.viewDidMoveToWindow();if window == nil{animationTimer?.invalidate();animationTimer=nil}}

    override var isOpaque: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    init(regions: [NSRect], label: String) {
        self.regions = regions
        self.label = String(label.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        super.init(frame: .zero)
    }
    required init?(coder: NSCoder) { nil }

    override func draw(_ dirtyRect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        context.saveGState()
        defer { context.restoreGState() }
        context.clear(bounds)
        context.setFillColor(NSColor(calibratedRed: 0.045, green: 0.075, blue: 0.12, alpha: 0.09).cgColor)
        context.fill(bounds)
        // Clearing each rounded region gives union holes, including overlaps.
        // An even-odd compound path would incorrectly darken overlapping holes.
        context.setBlendMode(.clear)
        for region in regions {
            context.addPath(CGPath(roundedRect: region, cornerWidth: min(10, region.width / 4),
                                   cornerHeight: min(10, region.height / 4), transform: nil))
            context.fillPath()
        }
        context.setBlendMode(.normal)
        let t=time, reduced=NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let appear=reduced ? 1 : min(1,max(0,t/0.18))
        let fade=reduced ? 1 : min(1,max(0,(2.6-t)/0.4))
        let gradient=CGGradient(colorsSpace:CGColorSpaceCreateDeviceRGB(),colors:palette.map{$0.cgColor} as CFArray,locations:[0,0.5,1])!
        for (index,region) in regions.enumerated() {
            let path=CGPath(roundedRect:region.insetBy(dx:0.5,dy:0.5),cornerWidth:min(8,region.width/4),cornerHeight:min(8,region.height/4),transform:nil)
            context.saveGState()
            context.setAlpha(appear*fade)
            // The gradient is clipped to the stroke: the content itself stays legible.
            context.addPath(path);context.setLineWidth(3)
            context.replacePathWithStrokedPath();context.clip()
            let shift=reduced ? 0 : CGFloat(min(1,t/0.75))*region.width*0.3
            context.drawLinearGradient(gradient,start:CGPoint(x:region.minX-shift,y:region.maxY),end:CGPoint(x:region.maxX-shift,y:region.minY),options:[.drawsBeforeStartLocation,.drawsAfterEndLocation])
            context.restoreGState()
            if !reduced && t<0.9 {
                context.saveGState();context.setAlpha(appear*fade*0.9)
                context.setStrokeColor(NSColor.white.cgColor);context.setLineWidth(2)
                context.setLineDash(phase:-CGFloat(t*240),lengths:[12, max(24,(region.width+region.height)*2-12)])
                context.addPath(path);context.strokePath();context.restoreGState()
            }
            if index<3 && (reduced || (t>=0.7 && t<1.35)) {
                let p=reduced ? CGFloat(0.6) : CGFloat(sin(.pi*min(1,max(0,(t-0.7)/0.65))))
                let x=region.maxX+5,y=region.maxY+5,r=6*p
                context.saveGState();context.setAlpha(fade*p);context.setFillColor(palette[index%palette.count].cgColor)
                context.move(to:CGPoint(x:x,y:y+r));context.addLine(to:CGPoint(x:x+r*0.3,y:y+r*0.3));context.addLine(to:CGPoint(x:x+r,y:y));context.addLine(to:CGPoint(x:x+r*0.3,y:y-r*0.3));context.addLine(to:CGPoint(x:x,y:y-r));context.addLine(to:CGPoint(x:x-r*0.3,y:y-r*0.3));context.addLine(to:CGPoint(x:x-r,y:y));context.addLine(to:CGPoint(x:x-r*0.3,y:y+r*0.3));context.closePath();context.fillPath();context.restoreGState()
            }
        }
        if let primary = regions.first, !label.isEmpty { drawLabel(near: primary) }
    }

    private func drawLabel(near region: NSRect) {
        let font = NSFont.systemFont(ofSize: 12, weight: .medium)
        let text = NSAttributedString(string: label, attributes: [.font: font,
            .foregroundColor: NSColor(calibratedRed: 0.067, green: 0.196, blue: 0.392, alpha: 1)])
        let width = min(max(64, text.size().width + 30), max(64, min(260, bounds.width - 16)))
        let x = min(max(8, region.minX), max(8, bounds.width - width - 8))
        let above = region.maxY + 8
        let y = min(max(8, above), max(8, bounds.height - 34))
        let pill = NSRect(x: x, y: y, width: width, height: 26)
        let path = NSBezierPath(roundedRect: pill, xRadius: 13, yRadius: 13)
        NSColor(calibratedWhite: 0.99, alpha: 0.97).setFill(); path.fill()
        accent.withAlphaComponent(0.65).setStroke(); path.lineWidth = 0.75; path.stroke()
        accent.setFill()
        NSBezierPath(ovalIn: NSRect(x: x + 10, y: y + 10, width: 6, height: 6)).fill()
        text.draw(with: NSRect(x: x + 22, y: y + 5, width: width - 30, height: 17),
                  options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine])
    }
}
