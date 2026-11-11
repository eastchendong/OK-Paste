// Append this file after Sources/PackDragVisual.swift in one temporary main.swift.
// It renders real production NSViews offscreen; no windows or drag sessions open.
import AppKit

let visualOutput = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: visualOutput, withIntermediateDirectories: true)
_ = NSApplication.shared
func fixture(_ color: NSColor, _ number: Int) -> NSImage {
    NSImage(size: NSSize(width: 80, height: 64), flipped: true) { rect in
        color.setFill(); NSBezierPath(roundedRect: rect.insetBy(dx: 2, dy: 2), xRadius: 8, yRadius: 8).fill()
        NSColor.white.setFill(); NSBezierPath(ovalIn: NSRect(x: 23, y: 16, width: 33, height: 33)).fill()
        let n = NSAttributedString(string: String(number), attributes: [.font: NSFont.systemFont(ofSize: 20, weight: .bold), .foregroundColor: color])
        n.draw(at: NSPoint(x: 34, y: 21)); return true
    }
}
let entries = [PackDragVisual.Entry(title: "参考资料与交互笔记", image: fixture(.systemBlue, 1)), PackDragVisual.Entry(title: "第二张图片", image: fixture(.systemOrange, 2)), PackDragVisual.Entry(title: "补充文字", image: nil)]
let frames: [(String, CGFloat, NSSize, Int)] = [
    ("source", 0, NSSize(width:340,height:62), 3),
    ("morph", 0.5, NSSize(width:244,height:53), 3),
    ("capsule", 1, NSSize(width:144,height:44), 3),
    ("capsule-one", 1, NSSize(width:144,height:44), 1),
    ("capsule-200", 1, NSSize(width:144,height:44), 200)
]
for (name, progress, size, count) in frames {
    let view = PackDragContentView(entries: count == 1 ? Array(entries.prefix(1)) : entries, count: count)
    view.frame = NSRect(origin:.zero,size:size);view.progress=progress
    view.layoutSubtreeIfNeeded()
    guard let rep=view.bitmapImageRepForCachingDisplay(in:view.bounds) else {fatalError("Missing cache representation")}
    view.cacheDisplay(in:view.bounds,to:rep)
    guard let png=rep.representation(using:.png,properties:[:]) else {fatalError("Missing PNG")}
    try png.write(to:visualOutput.appendingPathComponent(name+".png"))
    precondition(rep.pixelsWide >= Int(size.width) && rep.pixelsHigh >= Int(size.height))
    print("Rendered \(name): \(Int(size.width))×\(Int(size.height)), \(png.count) bytes")
}
let point=NSPoint(x:-1900,y:350)
let capsule=PackDragVisual.capsuleFrame(at:point)
precondition(capsule.origin == NSPoint(x:-1888,y:328))
precondition(capsule.size == NSSize(width:144,height:44))
let evidence:[String:Any] = ["result":"passed","productionViewRendered":true,"nativeWindowsOpened":false,"nativeDragPerformed":false,"frames":frames.map{$0.0},"negativeGlobalScreenCoordinates":true]
let json=try JSONSerialization.data(withJSONObject:evidence,options:[.prettyPrinted,.sortedKeys])
try json.write(to:visualOutput.appendingPathComponent("result.json"))
