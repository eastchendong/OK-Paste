import AppKit

let source=URL(fileURLWithPath:CommandLine.arguments[1])
let output=URL(fileURLWithPath:CommandLine.arguments[2])
try FileManager.default.createDirectory(at:output,withIntermediateDirectories:true)
guard let art=NSImage(contentsOf:source) else {fatalError("AppIcon.svg could not be read")}
func png(_ image:NSImage,_ pixels:Int)->Data {
    let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:pixels,pixelsHigh:pixels,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
    NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:bitmap)
    image.draw(in:NSRect(x:0,y:0,width:pixels,height:pixels),from:.zero,operation:.copy,fraction:1)
    NSGraphicsContext.restoreGraphicsState()
    return bitmap.representation(using:.png,properties:[:])!
}
let set=output.appendingPathComponent("AppIcon.iconset")
try FileManager.default.createDirectory(at:set,withIntermediateDirectories:true)
for size in [16,32,128,256,512] {
    try png(art,size).write(to:set.appendingPathComponent("icon_\(size)x\(size).png"))
    try png(art,size*2).write(to:set.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
try png(art,1024).write(to:output.appendingPathComponent("AppIcon.png"))

// Generated from the same local Figma layers as the dock and app icon.
let statusSource=source.deletingLastPathComponent().appendingPathComponent("StatusIcon.svg")
guard let status=NSImage(contentsOf:statusSource) else {fatalError("StatusIcon.svg could not be read")}
try png(status,36).write(to:output.appendingPathComponent("StatusIcon.png"))
