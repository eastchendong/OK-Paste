import AppKit
import ApplicationServices

/// Read-only bridge from host-confirmed result identities to actual AX screen geometry.
/// No selection changes, keyboard events, mouse movement or document decorations.
enum ResultLocator {
    struct Span { let range: NSRange; let text: String }
    static func attribute(_ node: AXUIElement, _ name: String) -> CFTypeRef? {
        AXUIElementSetMessagingTimeout(node,0.08)
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(node, name as CFString, &value) == .success ? value : nil
    }
    static func frame(_ node: AXUIElement) -> CGRect? {
        guard let position = attribute(node, kAXPositionAttribute), CFGetTypeID(position) == AXValueGetTypeID(),
              let sizeValue = attribute(node, kAXSizeAttribute), CFGetTypeID(sizeValue) == AXValueGetTypeID() else { return nil }
        let p = position as! AXValue, s = sizeValue as! AXValue
        var point = CGPoint.zero, size = CGSize.zero
        guard AXValueGetValue(p, .cgPoint, &point), AXValueGetValue(s, .cgSize, &size), size.width > 0, size.height > 0 else { return nil }
        return CGRect(origin: point, size: size)
    }
    static func normalized(_ text: String) -> (String, [NSRange]) {
        var value = "", map: [NSRange] = [], offset = 0
        for c in text {
            let part = String(c), length = (part as NSString).length
            if !part.unicodeScalars.allSatisfy({ CharacterSet.whitespacesAndNewlines.contains($0) }) {
                value += part; map += Array(repeating: NSRange(location: offset, length: length), count: length)
            }
            offset += length
        }
        return (value, map)
    }
    static func uniqueRange(text: String, needle: String) -> NSRange? {
        let (hay, map) = normalized(text), (key, _) = normalized(needle)
        guard !key.isEmpty, key.utf16.count <= 100000 else { return nil }
        let source = hay as NSString, found = source.range(of: key)
        guard found.location != NSNotFound, NSMaxRange(found) <= map.count else { return nil }
        let next = NSRange(location: found.location + 1, length: source.length - found.location - 1)
        guard source.range(of: key, range: next).location == NSNotFound else { return nil }
        return NSRange(location: map[found.location].location, length: NSMaxRange(map[NSMaxRange(found)-1])-map[found.location].location)
    }
    static func contextualRange(text: String, needle: String, before: String, after: String) -> NSRange? {
        let (hay,map)=normalized(text), (prefix,_)=normalized(before), (key,_)=normalized(needle), (suffix,_)=normalized(after)
        guard !key.isEmpty,let whole=uniqueRange(text:hay,needle:prefix+key+suffix) else{return nil}
        let start=whole.location+(prefix as NSString).length,end=start+(key as NSString).length
        guard start<end,end<=map.count else{return nil}
        return NSRange(location:map[start].location,length:NSMaxRange(map[end-1])-map[start].location)
    }
    static func cocoa(_ rect: CGRect) -> CGRect {
        let top = NSScreen.screens.first?.frame.maxY ?? 0
        return CGRect(x:rect.minX, y:top-rect.maxY, width:rect.width, height:rect.height)
    }
    static func focusedWindowMatches(app:NSRunningApplication,window:CGRect,desktopTop:CGFloat)->Bool {
        let root=AXUIElementCreateApplication(app.processIdentifier)
        guard let value=attribute(root,kAXFocusedWindowAttribute), CFGetTypeID(value)==AXUIElementGetTypeID(),
              let r=frame(value as! AXUIElement) else{return false}
        let actual=CGRect(x:r.minX,y:desktopTop-r.maxY,width:r.width,height:r.height)
        return abs(actual.minX-window.minX)<2 && abs(actual.minY-window.minY)<2 && abs(actual.width-window.width)<2 && abs(actual.height-window.height)<2
    }
    static func cellBounds(nodes:[AXUIElement],address:String,text:String,top:CGFloat)->CGRect? {
        let key=address.replacingOccurrences(of:"$",with:"").uppercased()
        guard let match=key.range(of:"^[A-Z]+[1-9][0-9]*$",options:.regularExpression),String(key[match])==key else{return nil}
        let letters=key.prefix(while:{$0.isLetter}),row=Int(key.dropFirst(letters.count)) ?? 0
        var column=0;for c in letters.utf8{column=column*26+Int(c)-64}
        guard row>0,column>0 else{return nil}
        var rects:[CGRect]=[]
        for node in nodes {
            let role=attribute(node,kAXRoleAttribute) as? String ?? ""
            guard [kAXTableRole,kAXOutlineRole,"AXLayoutArea"].contains(role) else{continue}
            var raw:CFTypeRef?
            let position=[column-1,row-1] as CFArray
            if AXUIElementCopyParameterizedAttributeValue(node,kAXCellForColumnAndRowParameterizedAttribute as CFString,position,&raw) == .success,
               let raw,CFGetTypeID(raw)==AXUIElementGetTypeID(){
                let cell=raw as! AXUIElement
                let value=attribute(cell,kAXValueAttribute) as? String ?? ""
                if normalized(value).0==normalized(text).0,let r=frame(cell){rects.append(CGRect(x:r.minX,y:top-r.maxY,width:r.width,height:r.height))}
            }
        }
        let distinct=Array(Set(rects.map{NSStringFromRect($0)}))
        return distinct.count==1 ? NSRectFromString(distinct[0]) : nil
    }
    static func lineRange(_ node:AXUIElement,index:Int)->NSRange? {
        var raw:CFTypeRef?
        guard AXUIElementCopyParameterizedAttributeValue(node,kAXLineForIndexParameterizedAttribute as CFString,index as CFNumber,&raw) == .success,
              let line=raw as? NSNumber else{return nil}
        raw=nil
        guard AXUIElementCopyParameterizedAttributeValue(node,kAXRangeForLineParameterizedAttribute as CFString,line,&raw) == .success,
              let raw,CFGetTypeID(raw)==AXValueGetTypeID() else{return nil}
        var range=CFRange()
        guard AXValueGetValue(raw as! AXValue,.cfRange,&range),range.location>=0,range.length>0 else{return nil}
        return NSRange(location:range.location,length:range.length)
    }
    static func bounds(_ node: AXUIElement, _ range: NSRange, desktopTop: CGFloat? = nil) -> CGRect? {
        var parameter = CFRange(location:range.location,length:range.length)
        guard let value = AXValueCreate(.cfRange, &parameter) else { return nil }
        var output: CFTypeRef?
        guard AXUIElementCopyParameterizedAttributeValue(node, kAXBoundsForRangeParameterizedAttribute as CFString, value, &output) == .success,
              let raw = output, CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
        var rect = CGRect.zero
        guard AXValueGetValue(raw as! AXValue, .cgRect, &rect), rect.width > 0, rect.height > 0 else { return nil }
        let top=desktopTop ?? NSScreen.screens.first?.frame.maxY ?? 0
        return CGRect(x:rect.minX,y:top-rect.maxY,width:rect.width,height:rect.height)
    }
    static func resolve(app: NSRunningApplication, window: CGRect, receipt: [String:Any], desktopTop:CGFloat? = nil) -> [CGRect] {
        let top=desktopTop ?? NSScreen.screens.first?.frame.maxY ?? 0
        let convert:(CGRect)->CGRect={r in CGRect(x:r.minX,y:top-r.maxY,width:r.width,height:r.height)}
        guard let locators = receipt["locators"] as? [[String:Any]], locators.count <= 100 else { return [] }
        let root = AXUIElementCreateApplication(app.processIdentifier)
        // Only the actual target window can provide geometry. Never use a similarly named background document.
        let windows = attribute(root,kAXWindowsAttribute) as? [AXUIElement] ?? []
        let matches = windows.filter { frame($0).map { r in let c=convert(r); return abs(c.minX-window.minX)<3 && abs(c.minY-window.minY)<3 && abs(c.width-window.width)<3 && abs(c.height-window.height)<3 } ?? false }
        guard matches.count == 1 else { return [] }
        var nodes:[AXUIElement]=[], queue:[AXUIElement]=[matches[0]], count=0,seen=Set<CFHashCode>()
        let deadline=Date().addingTimeInterval(1.2)
        while !queue.isEmpty && count<1500 && Date()<deadline {
            let node=queue.removeLast();count += 1
            guard seen.insert(CFHash(node)).inserted else{continue}
            let role=attribute(node,kAXRoleAttribute) as? String ?? ""
            if [kAXMenuBarRole,kAXMenuRole,kAXToolbarRole,kAXButtonRole,kAXComboBoxRole,kAXSliderRole,kAXTabGroupRole].contains(role){continue}
            nodes.append(node)
            if [kAXTextAreaRole,kAXTextFieldRole,kAXStaticTextRole,kAXCellRole].contains(role){
                if let children=attribute(node,kAXChildrenAttribute) as? [AXUIElement]{nodes.append(contentsOf:children.filter{attribute($0,kAXRoleAttribute) as? String == kAXImageRole})}
                continue
            }
            if let children=attribute(node,kAXChildrenAttribute) as? [AXUIElement] {queue.append(contentsOf:children.reversed())}
        }
        guard Date()<deadline else{return []}
        var result:[CGRect]=[]
        var capture:ResultVisionLocator.Capture?
        func visionAreas(_ kind:String)->[CGRect] {
            nodes.compactMap{node in
                let role=attribute(node,kAXRoleAttribute) as? String ?? ""
                let label=attribute(node,kAXDescriptionAttribute) as? String ?? attribute(node,kAXTitleAttribute) as? String ?? ""
                let allowed = kind=="cell" ? label.contains("Workbook area") : kind=="rendered-surface" ? label.contains("Slide Editor Pane") || label.contains("Page ") : [kAXTextAreaRole,kAXTextFieldRole].contains(role)
                guard allowed,let r=frame(node) else{return nil}
                return convert(r).intersection(window)
            }
        }
        func visual(_ locator:[String:Any],kind:String)->[CGRect] {
            let areas=visionAreas(locator["scope"] as? String == "document" ? "text" : kind)
            guard !areas.isEmpty else{return []}
            if capture==nil{capture=ResultVisionLocator.capture(app:app,window:window,top:top)}
            guard let capture else{return []}
            let images=nodes.compactMap{node->CGRect? in guard attribute(node,kAXRoleAttribute) as? String == kAXImageRole,let r=frame(node) else{return nil};return convert(r)}
            return kind=="rendered-surface" ? ResultVisionLocator.surface(locator,capture:capture,areas:areas,imageFrames:images) : ResultVisionLocator.text(locator,capture:capture,areas:areas)
        }
        for locator in locators {
            let kind=locator["kind"] as? String ?? ""
            if kind == "rendered-surface" {
                let found=visual(locator,kind:kind);guard !found.isEmpty else{return []};result.append(contentsOf:found);continue
            }
            if kind == "surface", let size=locator["size"] as? [String:Double], let w=size["width"], let h=size["height"],
               w>0,h>0, let regions=locator["regions"] as? [[String:Double]] {
                let surfaces=nodes.compactMap { node -> CGRect? in
                    guard let r=frame(node),abs(r.width-w)<2,abs(r.height-h)<2 else{return nil}
                    return convert(r)
                }
                let distinct=Array(Set(surfaces.map{NSStringFromRect($0)})).compactMap{NSRectFromString($0)}
                guard distinct.count==1,let surface=distinct.first else{return []}
                for r in regions {
                    guard let x=r["x"],let y=r["y"],let rw=r["width"],let rh=r["height"],x>=0,y>=0,rw>0,rh>0,x+rw<=1,y+rh<=1 else{return []}
                    result.append(CGRect(x:surface.minX+x*surface.width,y:surface.maxY-(y+rh)*surface.height,width:rw*surface.width,height:rh*surface.height))
                }
                continue
            }
            let text=locator["text"] as? String ?? "", name=locator["name"] as? String ?? "", address=locator["address"] as? String ?? ""
            if kind=="cell",let rect=cellBounds(nodes:nodes,address:address,text:text,top:top){result.append(rect);continue}
            var candidates:[(AXUIElement,NSRange?)]=[]
            for node in nodes {
                let role=attribute(node,kAXRoleAttribute) as? String ?? ""
                if kind == "element" {
                    let label=attribute(node,kAXTitleAttribute) as? String ?? attribute(node,kAXDescriptionAttribute) as? String ?? ""
                    if !name.isEmpty && label==name {candidates.append((node,nil))}
                } else if [kAXTextAreaRole,kAXTextFieldRole,kAXStaticTextRole,kAXCellRole].contains(role),
                          let value=attribute(node,kAXValueAttribute) as? String, !text.isEmpty,
                          let range=contextualRange(text:value,needle:text,before:locator["before"] as? String ?? "",after:locator["after"] as? String ?? "") {
                    if kind == "cell" {
                        let label=[attribute(node,kAXTitleAttribute) as? String,attribute(node,kAXDescriptionAttribute) as? String,attribute(node,kAXIdentifierAttribute) as? String].compactMap{$0}.joined(separator:" ")
                        guard !address.isEmpty,label.contains(address) else{continue}
                    }
                    candidates.append((node,range))
                }
            }
            // Ambiguity is a positioning failure, never a licence to choose the first matching sentence.
            if candidates.isEmpty {
                let found=visual(locator,kind:kind);guard !found.isEmpty else{return []};result.append(contentsOf:found);continue
            }
            guard candidates.count==1, let (node, range)=candidates.first else{return []}
            if let range {
                guard range.length<=12000 else{return []}
                var rows:[CGRect]=[]
                let value=attribute(node,kAXValueAttribute) as? String ?? ""
                let string=value as NSString
                var index=range.location
                while index<NSMaxRange(range) {
                    guard Date()<deadline else{return []}
                    let line=lineRange(node,index:index)
                    let character=line.map{NSIntersectionRange($0,range)} ?? string.rangeOfComposedCharacterSequence(at:index)
                    guard character.length>0,NSMaxRange(character)>index else{return []}
                    if let rect=bounds(node,character,desktopTop:top),rect.intersects(window) {
                        if let last=rows.last,abs(last.midY-rect.midY)<max(2,min(last.height,rect.height)*0.3),abs(last.height-rect.height)<max(3,last.height*0.35) {rows[rows.count-1]=last.union(rect)}
                        else{rows.append(rect)}
                    }
                    index=NSMaxRange(character)
                }
                if rows.isEmpty {let found=visual(locator,kind:kind);guard !found.isEmpty else{return []};result.append(contentsOf:found);continue}
                result.append(contentsOf:rows)
            } else if let r=frame(node) {result.append(convert(r))}
        }
        return result.compactMap { r in let c=r.intersection(window); return c.width>1 && c.height>1 ? c : nil }
    }
}
