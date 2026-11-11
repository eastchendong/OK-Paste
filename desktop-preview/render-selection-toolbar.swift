import AppKit

// Render the actual toolbar component offscreen; no AX access or screen capture.
@main struct RenderSelectionToolbar {
    static func main() throws {
        _ = NSApplication.shared
        let icon = URL(fileURLWithPath: CommandLine.arguments[1])
        let output = URL(fileURLWithPath: CommandLine.arguments[2])
        let view = SelectionToolbarView(iconURL: icon, target: nil, copyAction: nil, anchorAction: nil)
        // Verify the real view hierarchy, not just a white offscreen bitmap.
        let material = view.subviews[0]
        precondition((material as? NSVisualEffectView)?.state == .active)
        precondition(material.frame == view.bounds)
        precondition(view.subviews[1].layer?.backgroundColor?.alpha == ComponentLibrary.glass.alphaComponent)
        precondition(view.subviews.suffix(2).allSatisfy { $0 is SelectionActionButton })
        for case let button as SelectionActionButton in view.subviews where !button.isHidden {
            let textSize = (button.title as NSString).size(withAttributes: [.font: ComponentLibrary.font(ComponentLibrary.selectionFontSize)])
            precondition(view.bounds.contains(button.frame))
            precondition(textSize.width <= button.bounds.width - (8 + ComponentLibrary.selectionIconSize + 5) - 8)
            precondition(textSize.height <= button.bounds.height)
        }
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(view.bounds.width*2), pixelsHigh: Int(view.bounds.height*2), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        bitmap.size = view.bounds.size
        view.cacheDisplay(in: view.bounds, to: bitmap)
        try bitmap.representation(using: .png, properties: [:])!.write(to: output)
    }
}
