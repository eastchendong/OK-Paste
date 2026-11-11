// Generated from components-preview.html (2df26bb30092). Do not edit.
import AppKit
enum ComponentLibrary {
    static let ink = NSColor(calibratedRed:0.109804,green:0.125490,blue:0.141176,alpha:1.000000)
    static let muted = NSColor(calibratedRed:0.376471,green:0.392157,blue:0.423529,alpha:1.000000)
    static let blue = NSColor(calibratedRed:0.066667,green:0.196078,blue:0.392157,alpha:1.000000)
    static let paper = NSColor(calibratedRed:0.988235,green:0.988235,blue:0.992157,alpha:1.000000)
    static let control = NSColor(calibratedRed:0.976471,green:0.976471,blue:0.984314,alpha:1.000000)
    static let line = NSColor(calibratedRed:0.850980,green:0.850980,blue:0.878431,alpha:1.000000)
    static let glass = NSColor(calibratedRed:1.000000,green:1.000000,blue:1.000000,alpha:0.900000)
    static let border = NSColor(calibratedRed:1.000000,green:1.000000,blue:1.000000,alpha:0.600000)
    static let secondary = NSColor(calibratedRed:1.000000,green:1.000000,blue:1.000000,alpha:0.700000)
    static let hover = NSColor(calibratedRed:0.000000,green:0.000000,blue:0.176471,alpha:0.090196)
    static let copyLabel = "加入内容包"
    static let anchorLabel = "设为目标位置"
    static let selectionAnchorEnabled = false
    static let selectionRadius: CGFloat = 10
    static let selectionButtonRadius: CGFloat = 7
    static let selectionFontSize: CGFloat = 11
    static let selectionIconSize: CGFloat = 14
    static let selectionSize = NSSize(width:102,height:32)
    static func font(_ size:CGFloat, bold:Bool = false) -> NSFont {
        NSFont(name:bold ? "PingFangSC-Semibold" : "PingFangSC-Regular",size:size) ?? .systemFont(ofSize:size,weight:bold ? .semibold : .regular)
    }
}
