import AppKit

// The pasteboard still uses a real NSDraggingSession. This mouse-transparent
// panel is only its visual, so morphing it never interferes with drop targets.
final class PackDragVisual {
    struct Entry {
        let title: String
        let image: NSImage?
    }
    private let capsuleSize = NSSize(width: 144, height: 44)
    private var panel: NSPanel?
    private var content: PackDragContentView?
    private var timer: Timer?
    private var sourceFrame = NSRect.zero
    private var started = Date.distantPast
    private var generation = 0
    private var morph: CGFloat = 0
    private var reducedMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    static func capsuleFrame(at point: NSPoint) -> NSRect {
        NSRect(x: point.x + 12, y: point.y - 22, width: 144, height: 44)
    }

    func begin(source: NSRect, entries: [Entry], count: Int) {
        close()
        generation += 1
        sourceFrame = source
        started = Date()
        morph = reducedMotion ? 1 : 0
        let window = NSPanel(contentRect: source, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        window.level = .statusBar
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.isOpaque = false; window.backgroundColor = .clear
        window.hasShadow = true; window.hidesOnDeactivate = false
        window.ignoresMouseEvents = true; window.animationBehavior = .none
        let view = PackDragContentView(entries: entries, count: count)
        window.contentView = view
        panel = window; content = view
        update()
        window.orderFrontRegardless()
        let tracking = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in self?.update() }
        timer = tracking
        RunLoop.main.add(tracking, forMode: .common)
    }

    private func update() {
        guard let panel else { return }
        let t = reducedMotion ? 1 : min(1, Date().timeIntervalSince(started) / 0.20)
        morph = CGFloat(1 - pow(1 - t, 3))
        let destination = Self.capsuleFrame(at: NSEvent.mouseLocation)
        let lerp: (CGFloat, CGFloat) -> CGFloat = { $0 + ($1 - $0) * self.morph }
        let frame = NSRect(x: lerp(sourceFrame.minX, destination.minX), y: lerp(sourceFrame.minY, destination.minY),
                           width: lerp(sourceFrame.width, capsuleSize.width), height: lerp(sourceFrame.height, capsuleSize.height))
        panel.setFrame(frame, display: true)
        content?.progress = morph
    }

    func end(accepted: Bool, at point: NSPoint, completion: @escaping () -> Void = {}) {
        timer?.invalidate(); timer = nil
        guard let panel else { completion(); return }
        generation += 1
        let token = generation
        let from = panel.frame
        let target = accepted ? Self.capsuleFrame(at: point) : sourceFrame
        let duration = reducedMotion ? 0 : (accepted ? 0.56 : 0.32)
        let startProgress = morph, startTime = Date()
        if accepted { panel.setFrame(target, display: true); content?.progress = 1 }
        let finish = { [weak self] in
            guard let self, self.generation == token else { return }
            self.close(); completion()
        }
        guard duration > 0 else { finish(); return }
        let returning = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            guard let self, self.generation == token else { return }
            let t = min(1, Date().timeIntervalSince(startTime) / duration)
            if !accepted {
                let eased = CGFloat(1 - pow(1 - t, 3))
                let lerp: (CGFloat, CGFloat) -> CGFloat = { $0 + ($1 - $0) * eased }
                // One small lift makes the return readable without a bounce.
                let arc = CGFloat(sin(t * .pi)) * min(32, abs(from.midX - target.midX) * 0.08)
                panel.setFrame(NSRect(x: lerp(from.minX, target.minX), y: lerp(from.minY, target.minY) + arc,
                                      width: lerp(from.width, target.width), height: lerp(from.height, target.height)), display: true)
                self.content?.progress = startProgress * (1 - eased)
            }
            if t >= 1 { finish() }
        }
        timer = returning; RunLoop.main.add(returning, forMode: .common)
    }

    func close() {
        timer?.invalidate(); timer = nil
        panel?.orderOut(nil); panel?.close(); panel = nil; content = nil
    }
}

private final class PackDragContentView: NSView {
    private let entries: [PackDragVisual.Entry]
    private let count: Int
    private let glass = NativeGlass.make()
    private let artwork: PackDragArtworkView
    var progress: CGFloat = 0 { didSet { artwork.progress = progress; NativeGlass.setRadius(12 + 10 * progress, on: glass) } }
    override var isFlipped: Bool { true }

    init(entries: [PackDragVisual.Entry], count: Int) {
        self.entries = entries; self.count = count; self.artwork = PackDragArtworkView(entries: entries, count: count)
        super.init(frame: .zero)
        wantsLayer = true
        glass.autoresizingMask = [.width, .height]
        artwork.autoresizingMask = [.width, .height]
        addSubview(glass); addSubview(artwork)
    }
    required init?(coder: NSCoder) { nil }
    override func layout() { super.layout(); glass.frame = bounds; artwork.frame = bounds }
}

private final class PackDragArtworkView: NSView {
    let entries: [PackDragVisual.Entry]
    let count: Int
    var progress: CGFloat = 0 { didSet { needsDisplay = true } }
    override var isFlipped: Bool { true }
    init(entries: [PackDragVisual.Entry], count: Int) { self.entries = entries; self.count = count; super.init(frame: .zero) }
    required init?(coder: NSCoder) { nil }
    override func draw(_ dirtyRect: NSRect) {
        let p = progress, thumbSize: CGFloat = 42 - 14 * p
        let shown = Array(entries.prefix(3))
        for (index, entry) in shown.enumerated().reversed() {
            let shift = CGFloat(index) * (1 - p) * 3 + CGFloat(index) * p * 15
            let rect = NSRect(x: 10 + shift, y: (bounds.height - thumbSize) / 2, width: thumbSize, height: thumbSize)
            NSGraphicsContext.saveGraphicsState()
            let outline = NSBezierPath(roundedRect: rect, xRadius: 7, yRadius: 7)
            ComponentLibrary.paper.setFill(); outline.fill()
            ComponentLibrary.line.withAlphaComponent(0.8).setStroke(); outline.lineWidth = 0.5; outline.stroke()
            outline.addClip()
            if let image = entry.image {
                let size = image.size
                let scale = min((rect.width - 4) / max(1, size.width), (rect.height - 4) / max(1, size.height))
                let target = NSRect(x: rect.midX - size.width * scale / 2, y: rect.midY - size.height * scale / 2, width: size.width * scale, height: size.height * scale)
                image.draw(in: target, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
            } else {
                ComponentLibrary.blue.withAlphaComponent(0.55).setFill()
                for line in 0..<3 {
                    let width = rect.width * (line == 2 ? 0.44 : 0.66)
                    NSBezierPath(roundedRect: NSRect(x: rect.minX + rect.width * 0.17, y: rect.minY + rect.height * 0.29 + CGFloat(line) * rect.height * 0.17, width: width, height: 2), xRadius: 1, yRadius: 1).fill()
                }
            }
            NSGraphicsContext.restoreGraphicsState()
        }
        let title = p > 0.48 ? "\(count) 项" : (entries.first?.title ?? "\(count) 项")
        let paragraph = NSMutableParagraphStyle(); paragraph.lineBreakMode = .byTruncatingTail
        let text = NSAttributedString(string: title, attributes: [.font: ComponentLibrary.font(13, bold: true), .foregroundColor: ComponentLibrary.blue, .paragraphStyle: paragraph])
        let x: CGFloat = p > 0.48 ? 16 + 28 + CGFloat(max(0, shown.count - 1)) * 15 + 10 : 64
        text.draw(in: NSRect(x: x, y: bounds.midY - 9, width: max(20, bounds.width - x - 10), height: 20))
    }
}
