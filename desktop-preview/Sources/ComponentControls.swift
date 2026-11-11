import AppKit

// Native settings use the library's palette, typography and action-button
// metrics. Text fields stay native so secure entry and editing remain intact.
final class ComponentActionButton: NSButton {
    private let primary: Bool
    private var hovered = false
    init(title: String, target: AnyObject?, action: Selector?, primary: Bool = false) {
        self.primary = primary
        super.init(frame: .zero)
        self.title = title; self.target = target; self.action = action
        isBordered = false; setButtonType(.momentaryPushIn)
        font = ComponentLibrary.font(12, bold: true)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
    override var intrinsicContentSize: NSSize {
        let width = (title as NSString).size(withAttributes: [.font: ComponentLibrary.font(12, bold: true)]).width
        return NSSize(width: max(60, ceil(width) + 24), height: 34)
    }
    override func updateTrackingAreas() {
        super.updateTrackingAreas(); trackingAreas.forEach { removeTrackingArea($0) }
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited,.activeAlways], owner: self))
    }
    override func mouseEntered(with event: NSEvent) { hovered = true; needsDisplay = true }
    override func mouseExited(with event: NSEvent) { hovered = false; needsDisplay = true }
    override func draw(_ dirtyRect: NSRect) {
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 10, yRadius: 10)
        (primary ? ComponentLibrary.blue : hovered || isHighlighted ? ComponentLibrary.glass : ComponentLibrary.secondary).setFill(); path.fill()
        if !primary { ComponentLibrary.line.setStroke(); path.lineWidth = 0.5; path.stroke() }
        let color = primary ? ComponentLibrary.paper : ComponentLibrary.muted
        let text = NSAttributedString(string: title, attributes: [.font: ComponentLibrary.font(12, bold: true), .foregroundColor: color.withAlphaComponent(isEnabled ? 1 : 0.6)])
        let size = text.size(); text.draw(at: NSPoint(x: (bounds.width-size.width)/2, y: (bounds.height-size.height)/2))
    }
}
