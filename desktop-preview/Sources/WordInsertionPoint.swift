import AppKit
import ApplicationServices

/// Screen placement is separate from the Office object used to perform the edit.
final class OfficeSelectionPoint {
    private var monitor: Any?
    private var click: (pid: pid_t, point: NSPoint)?
    func start() {
        monitor = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown) { [weak self] _ in
            guard let app = NSWorkspace.shared.frontmostApplication,
                  ["com.microsoft.Word", "com.microsoft.Excel", "com.microsoft.Powerpoint", "com.adobe.illustrator", "com.figma.Desktop"].contains(app.bundleIdentifier ?? "") else { return }
            self?.click = (app.processIdentifier, NSEvent.mouseLocation)
        }
    }
    func stop() { if let monitor { NSEvent.removeMonitor(monitor) }; monitor = nil }
    func placement(for app: NSRunningApplication) -> (point: NSPoint, exact: Bool)? {
        if AXIsProcessTrusted() {
            let application = AXUIElementCreateApplication(app.processIdentifier)
            var focused: CFTypeRef?
            if AXUIElementCopyAttributeValue(application, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
               let focused, CFGetTypeID(focused) == AXUIElementGetTypeID() {
                let element = focused as! AXUIElement
                var selected: CFTypeRef?, bounds: CFTypeRef?
                if AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &selected) == .success,
                   let selected, AXUIElementCopyParameterizedAttributeValue(element, kAXBoundsForRangeParameterizedAttribute as CFString, selected, &bounds) == .success,
                   let bounds, CFGetTypeID(bounds) == AXValueGetTypeID() {
                    var rect = CGRect.zero
                    if AXValueGetValue(bounds as! AXValue, .cgRect, &rect), rect.height > 0 {
                        let top = NSScreen.screens.first?.frame.maxY ?? 0
                        return (NSPoint(x: rect.minX, y: top - rect.maxY), true)
                    }
                }
            }
        }
        // Office may hide AX caret/cell geometry. This fallback places the UI
        // by the last click only; writes always use the tracked Office.js object.
        if let click, click.pid == app.processIdentifier { return (click.point, false) }
        return nil
    }
}
