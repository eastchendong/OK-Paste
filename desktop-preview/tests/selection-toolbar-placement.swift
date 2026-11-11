import Foundation
import CoreGraphics

@main struct SelectionToolbarPlacementTests {
    static func main() {
        let screen = CGRect(x: 0, y: 0, width: 1000, height: 800)
        let size = CGSize(width: 214, height: 32)
        func place(_ selection: CGRect?, pointer: CGPoint = CGPoint(x: 300, y: 400), screens: [CGRect] = []) -> CGRect {
            SelectionToolbarPlacement.frame(selection: selection, pointer: pointer, size: size, visibleFrames: screens.isEmpty ? [screen] : screens)
        }
        let line = CGRect(x: 200, y: 400, width: 240, height: 24)
        let below = place(line)
        precondition(below.maxY == line.minY - 6 && !below.intersects(line))
        let multiline = CGRect(x: 100, y: 250, width: 400, height: 300)
        precondition(place(multiline).maxY == multiline.minY - 6)
        let bottom = CGRect(x: 200, y: 15, width: 240, height: 24)
        precondition(place(bottom).minY == bottom.maxY + 6)
        let right = place(CGRect(x: 950, y: 400, width: 35, height: 24))
        precondition(right.maxX == screen.maxX - 8)
        let caret = CGRect(x: 200, y: 400, width: 0, height: 24)
        precondition(place(caret).maxY == caret.minY - 6)
        precondition(place(nil).maxY == 394)
        let leftScreen = CGRect(x: -1000, y: -100, width: 1000, height: 800)
        let leftSelection = CGRect(x: -800, y: 300, width: 200, height: 24)
        let otherDisplay = place(leftSelection, screens: [screen, leftScreen])
        precondition(leftScreen.contains(otherDisplay) && otherDisplay.maxY == leftSelection.minY - 6)
        let tall = place(CGRect(x: 200, y: -20, width: 250, height: 850))
        precondition(screen.contains(tall))
        precondition(place(CGRect(x: 2000, y: 2000, width: 200, height: 24)) == place(nil))
        print("Selection toolbar placement: 9 cases passed (below, multiline, bottom flip, right edge, caret, pointer fallback, multiple displays, tall range, offscreen range).")
    }
}
