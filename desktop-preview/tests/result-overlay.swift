// Appended after Sources/ResultOverlay.swift into a temporary main.swift.
import AppKit

let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
_ = NSApplication.shared
NSApp.setActivationPolicy(.prohibited)

func close(_ actual: CGFloat, _ expected: CGFloat) -> Bool { abs(actual - expected) < 0.001 }
let frame = CGRect(x: 20, y: 100, width: 1512, height: 862)
let normalized = CGRect(x: 0.25, y: 0.25, width: 0.5, height: 0.5)
let mapped = ResultOverlay.normalizeToScreen(regions: [normalized], windowFrame: frame,
                                              sourcePixelSize: CGSize(width: 3024, height: 1660), backingScale: 2)!
precondition(mapped.count == 1 && close(mapped[0].minX, 398) && close(mapped[0].minY, 307.5))
precondition(close(mapped[0].width, 756) && close(mapped[0].height, 415))
let negativeWindow = CGRect(x: -1512, y: -300, width: 1512, height: 862)
let full = ResultOverlay.normalizeToScreen(regions: [CGRect(x: 0, y: 0, width: 1, height: 1)], windowFrame: negativeWindow,
                                            sourcePixelSize: CGSize(width: 3024, height: 1660), backingScale: 2)!
precondition(full == [CGRect(x: -1512, y: -300, width: 1512, height: 830)])
let oneX = ResultOverlay.normalizeToScreen(regions: [normalized], windowFrame: frame,
                                            sourcePixelSize: CGSize(width: 1512, height: 830), backingScale: 2)!
precondition(oneX == mapped)
for pixels in [CGSize.zero, CGSize(width: 2700, height: 1660), CGSize(width: 3024, height: 1900), CGSize(width: CGFloat.nan, height: 1660)] {
    precondition(ResultOverlay.normalizeToScreen(regions: [normalized], windowFrame: frame, sourcePixelSize: pixels, backingScale: 2) == nil)
}
precondition(ResultOverlay.normalizeToScreen(regions: [normalized], windowFrame: CGRect(x: 0, y: 0, width: 1512, height: 1000), sourcePixelSize: CGSize(width: 3024, height: 1660), backingScale: 2) == nil)
for region in [CGRect(x: -0.1, y: 0, width: 0.5, height: 0.5), CGRect(x: 0.8, y: 0, width: 0.5, height: 0.5), CGRect(x: 0, y: 0, width: 0, height: 1)] {
    precondition(ResultOverlay.normalizeToScreen(regions: [region], windowFrame: frame, sourcePixelSize: CGSize(width: 3024, height: 1660), backingScale: 2) == nil)
}

let localHoles = [NSRect(x: 100, y: 100, width: 200, height: 200), NSRect(x: 220, y: 140, width: 220, height: 160)]
for (name, screen) in [("positive", NSRect(x: 60, y: 80, width: 640, height: 400)), ("negative", NSRect(x: -1920, y: -500, width: 640, height: 400))] {
    let global = localHoles.map { $0.offsetBy(dx: screen.minX, dy: screen.minY) }
    let clipped = ResultOverlay.clippedRegions(global, to: screen)
    let local = clipped.map { $0.offsetBy(dx: -screen.minX, dy: -screen.minY) }
    precondition(local == localHoles)
    let view = ResultOverlayView(regions: local, label: "")
    view.frame = NSRect(origin: .zero, size: screen.size)
    view.reviewTime = 1.4
    guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { fatalError("Missing bitmap") }
    view.cacheDisplay(in: view.bounds, to: rep)
    let scale = CGFloat(rep.pixelsWide) / screen.width
    func alpha(_ x: CGFloat, _ y: CGFloat) -> CGFloat {
        rep.colorAt(x: Int(x * scale), y: Int(y * scale))!.alphaComponent
    }
    // Distinct holes and their intersection remain transparent; outside stays dim.
    precondition(alpha(40, 200) > 0.05 && alpha(600, 200) > 0.05)
    precondition(alpha(150, 200) < 0.01 && alpha(260, 200) < 0.01 && alpha(400, 200) < 0.01)
    precondition(view.hitTest(NSPoint(x: 40, y: 200)) == nil)
    try rep.representation(using: .png, properties: [:])!.write(to: output.appendingPathComponent(name + ".png"))
}
let screen = NSRect(x: -640, y: 20, width: 640, height: 400)
let intersection = ResultOverlay.clippedRegions([NSRect(x: -700, y: 100, width: 200, height: 100)], to: screen)
precondition(intersection == [NSRect(x: -640, y: 100, width: 140, height: 100)])
precondition(ResultOverlay.clippedRegions([.zero, NSRect(x: CGFloat.nan, y: 0, width: 20, height: 20), NSRect(x: 0, y: 0, width: -20, height: 20)], to: screen).isEmpty)

let overlay = ResultOverlay()
let wasActive = NSApp.isActive
let key = NSApp.keyWindow
let hole = NSRect(x: -540, y: 120, width: 200, height: 120)
precondition(overlay.show(id: "first", screenFrame: screen, regions: [hole], label: "已生成", duration: 0.04))
let realPanel = overlay.panel!
precondition(realPanel.frame == screen && realPanel.isVisible)
precondition(realPanel.ignoresMouseEvents && !realPanel.acceptsMouseMovedEvents)
precondition(!realPanel.canBecomeKey && !realPanel.canBecomeMain && !realPanel.isKeyWindow && !realPanel.isMainWindow)
precondition(realPanel.styleMask.contains(.nonactivatingPanel) && !realPanel.isOpaque)
precondition(NSApp.keyWindow === key && NSApp.isActive == wasActive)
precondition(overlay.show(id: "second", screenFrame: screen, regions: [hole], label: "已生成", duration: 0.2))
RunLoop.main.run(until: Date().addingTimeInterval(0.08))
precondition(overlay.currentID == "second" && overlay.panel?.isVisible == true)
RunLoop.main.run(until: Date().addingTimeInterval(0.2))
precondition(overlay.panel == nil && overlay.currentID == nil && overlay.displayedRegions.isEmpty)
precondition(!overlay.show(id: "empty", screenFrame: screen, regions: [], label: "已生成"))
precondition(!overlay.show(id: "outside", screenFrame: screen, regions: [NSRect(x: 5000, y: 5000, width: 50, height: 50)], label: "已生成"))
precondition(!overlay.show(id: "invalid", screenFrame: .zero, regions: [hole], label: "已生成"))
precondition(overlay.panel == nil)
precondition(overlay.show(id: "cancel", screenFrame: screen, regions: [hole], label: "已生成", duration: 0.04))
overlay.hide()
RunLoop.main.run(until: Date().addingTimeInterval(0.08))
precondition(overlay.panel == nil && overlay.currentID == nil)

let report: [String: Any] = ["result": "passed", "normalizedPixelGeometryMapped": true, "retinaAndOneX": true,
    "negativeGlobalCoordinates": true, "overlappingHolesRemainTransparent": true, "invalidGeometryRejected": true,
    "realPanelMouseTransparent": true, "realPanelNeverKeyOrMain": true, "appActivationUnchanged": true,
    "replacementTimerProtected": true, "expiryAndExplicitHide": true, "systemInputSynthesized": false,
    "nativeWindowsOpened": true, "appInstalled": false]
try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent("result.json"))
print("ResultOverlay: mapper, union holes, negative screens, real panel properties, and lifecycle passed")
