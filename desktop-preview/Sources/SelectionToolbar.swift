import AppKit

final class SelectionActionButton: NSButton {
    var componentIcon: NSImage?
    private var hovered = false
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach { removeTrackingArea($0) }
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways], owner: self))
    }
    override func mouseEntered(with event: NSEvent) { hovered = true; needsDisplay = true }
    override func mouseExited(with event: NSEvent) { hovered = false; needsDisplay = true }
    override func draw(_ dirtyRect: NSRect) {
        if hovered && isEnabled || isHighlighted {
            ComponentLibrary.hover.setFill()
            NSBezierPath(roundedRect: bounds, xRadius: ComponentLibrary.selectionButtonRadius, yRadius: ComponentLibrary.selectionButtonRadius).fill()
        }
        let color = ComponentLibrary.blue.withAlphaComponent(isEnabled ? 1 : 0.6)
        let text = NSAttributedString(string: title, attributes: [.font: ComponentLibrary.font(ComponentLibrary.selectionFontSize), .foregroundColor: color])
        let size = text.size()
        let iconSize = ComponentLibrary.selectionIconSize
        text.draw(at: NSPoint(x: 8 + iconSize + 5, y: (bounds.height - size.height) / 2))
        if let icon = componentIcon {
            icon.draw(in: CGRect(x: 8, y: (bounds.height - iconSize) / 2, width: iconSize, height: iconSize), from: .zero, operation: .sourceOver, fraction: isEnabled ? 1 : 0.6)
        }
    }
}

final class SelectionToolbarView: NSView {
    private(set) var copyButton: NSButton!
    private(set) var anchorButton: NSButton!
    init(iconURL: URL, target: AnyObject?, copyAction: Selector?, anchorAction: Selector?) {
        super.init(frame: CGRect(origin: .zero, size: ComponentLibrary.selectionSize))
        let content = self; content.wantsLayer = true
        content.layer?.masksToBounds = true
        content.layer?.cornerRadius = ComponentLibrary.selectionRadius; content.layer?.borderWidth = 0.5
        content.layer?.borderColor = ComponentLibrary.border.cgColor
        let material = NativeGlass.make()
        material.frame = bounds; material.autoresizingMask = [.width, .height]
        NativeGlass.setRadius(ComponentLibrary.selectionRadius, on: material)
        content.addSubview(material)
        let tint = NSView(frame: bounds)
        tint.autoresizingMask = [.width, .height]; tint.wantsLayer = true
        tint.layer?.backgroundColor = ComponentLibrary.glass.cgColor
        content.addSubview(tint)
        let assets = iconURL.deletingLastPathComponent()
        let button = SelectionActionButton(frame: CGRect(x: 4, y: 4, width: 94, height: 24))
        button.title = ComponentLibrary.copyLabel; button.componentIcon = NSImage(contentsOf: assets.appendingPathComponent("SelectionPlus.svg")); button.target = target; button.action = copyAction
        button.isBordered = false; button.toolTip = "把当前选中文字加入内容包"
        let start = SelectionActionButton(frame: CGRect(x: 102, y: 4, width: 108, height: 24))
        start.title = ComponentLibrary.anchorLabel; start.componentIcon = NSImage(contentsOf: assets.appendingPathComponent("SelectionScan.svg")); start.target = target; start.action = anchorAction; start.isBordered = false
        start.toolTip = "标记要修改的位置，之后找来的参考将用于这里"
        start.isHidden = !ComponentLibrary.selectionAnchorEnabled
        button.setAccessibilityLabel(ComponentLibrary.copyLabel); start.setAccessibilityLabel(ComponentLibrary.anchorLabel)
        content.addSubview(button); content.addSubview(start)
        self.copyButton = button; self.anchorButton = start
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
}
