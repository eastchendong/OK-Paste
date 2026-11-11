import Foundation
import CoreGraphics

// Input and output use AppKit screen coordinates (origin at the bottom).
enum SelectionToolbarPlacement {
    static func frame(selection: CGRect?, pointer: CGPoint, size: CGSize, visibleFrames: [CGRect]) -> CGRect {
        let edge: CGFloat = 8, gap: CGFloat = 6
        let valid = selection.flatMap { rect -> CGRect? in
            guard [rect.minX, rect.minY, rect.width, rect.height].allSatisfy({ $0.isFinite }),
                  rect.width >= 0, rect.height >= 0, rect.width > 0 || rect.height > 0 else { return nil }
            return rect
        }
        let screens = visibleFrames.isEmpty ? [CGRect(x: 0, y: 0, width: 1280, height: 800)] : visibleFrames
        let overlaps = valid.map { rect in screens.map { screen -> CGFloat in
            let intersection = screen.intersection(rect.insetBy(dx: -0.5, dy: -0.5))
            return intersection.isNull ? 0 : intersection.width * intersection.height
        } }
        let index = overlaps.flatMap { values in
            values.indices.max(by: { values[$0] < values[$1] }).flatMap { values[$0] > 0 ? $0 : nil }
        } ?? screens.firstIndex(where: { $0.contains(pointer) }) ?? 0
        let visible = screens[index]
        let anchor = valid.flatMap { visible.intersects($0.insetBy(dx: -0.5, dy: -0.5)) ? $0 : nil }
        let x = min(max(visible.minX + edge, (anchor?.minX ?? pointer.x) - 2), max(visible.minX + edge, visible.maxX - size.width - edge))
        // Prefer below the whole selection, including tall multi-line ranges.
        let below = (anchor?.minY ?? pointer.y) - gap - size.height
        let above = (anchor?.maxY ?? pointer.y) + gap
        let y = below >= visible.minY + edge ? below : above + size.height <= visible.maxY - edge ? above : below
        return CGRect(x: x, y: min(max(visible.minY + edge, y), max(visible.minY + edge, visible.maxY - size.height - edge)), width: size.width, height: size.height)
    }
}
