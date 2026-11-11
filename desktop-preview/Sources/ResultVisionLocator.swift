import AppKit
import Vision

/// Local, read-only screenshot geometry. This runs only after a host acknowledges a write.
/// No model coordinates, network upload, screen recording request or target-app drawing.
enum ResultVisionLocator {
    struct Capture {let image:CGImage;let frame:CGRect;let top:CGFloat}
    static func capture(app:NSRunningApplication,window:CGRect,top:CGFloat)->Capture? {
        guard CGPreflightScreenCaptureAccess(),let rows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] else{return nil}
        let matches=rows.filter{r in
            guard (r[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value==app.processIdentifier,
                  let raw=r[kCGWindowBounds as String] as? [String:Any],let bounds=CGRect(dictionaryRepresentation:raw as CFDictionary) else{return false}
            return abs(bounds.minX-window.minX)<2 && abs(top-bounds.maxY-window.minY)<2 && abs(bounds.width-window.width)<2 && abs(bounds.height-window.height)<2
        }
        guard matches.count==1,let id=matches[0][kCGWindowNumber as String] as? NSNumber,
              let image=CGWindowListCreateImage(.null,.optionIncludingWindow,id.uint32Value,[.boundsIgnoreFraming,.bestResolution]) else{return nil}
        return Capture(image:image,frame:window,top:top)
    }
    static func rect(_ normalized:CGRect,in window:CGRect)->CGRect {
        CGRect(x:window.minX+normalized.minX*window.width,y:window.minY+normalized.minY*window.height,width:normalized.width*window.width,height:normalized.height*window.height)
    }
    static func normalized(_ global:CGRect,in window:CGRect)->CGRect {
        CGRect(x:(global.minX-window.minX)/window.width,y:(global.minY-window.minY)/window.height,width:global.width/window.width,height:global.height/window.height)
    }
    static func text(_ locator:[String:Any],capture:Capture,areas:[CGRect])->[CGRect] {
        guard let expected=locator["text"] as? String,!expected.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else{return []}
        let request=VNRecognizeTextRequest();request.recognitionLevel = .accurate
        request.recognitionLanguages=["zh-Hans","en-US"];request.usesLanguageCorrection=false
        guard (try? VNImageRequestHandler(cgImage:capture.image).perform([request])) != nil else{return []}
        let observations=(request.results ?? []).filter{o in
            let r=rect(o.boundingBox,in:capture.frame)
            return areas.contains{$0.contains(CGPoint(x:r.midX,y:r.midY))}
        }.sorted{a,b in abs(a.boundingBox.midY-b.boundingBox.midY)>0.012 ? a.boundingBox.midY>b.boundingBox.midY : a.boundingBox.minX<b.boundingBox.minX}
        var combined="",parts:[(VNRecognizedText,NSRange)]=[]
        for o in observations {
            guard let line=o.topCandidates(1).first,line.confidence>=0.8 else{continue}
            let offset=(combined as NSString).length
            combined+=line.string+"\n";parts.append((line,NSRange(location:offset,length:(line.string as NSString).length)))
        }
        guard let matched=ResultLocator.contextualRange(text:combined,needle:expected,before:locator["before"] as? String ?? "",after:locator["after"] as? String ?? "") else{return []}
        var found:[CGRect]=[]
        for (line,range) in parts {
            let intersection=NSIntersectionRange(range,matched)
            guard intersection.length>0,let a=String.Index(utf16Offset:intersection.location-range.location,in:line.string) as String.Index?,let b=String.Index(utf16Offset:NSMaxRange(intersection)-range.location,in:line.string) as String.Index?,let box=try? line.boundingBox(for:a..<b) else{continue}
            found.append(rect(box.boundingBox,in:capture.frame))
        }
        if locator["kind"] as? String == "cell" {
            guard found.count==1,let address=locator["address"] as? String else{return []}
            let column=String(address.prefix(while:{$0.isLetter})).uppercased(),row=String(address.dropFirst(column.count))
            let columns=observations.filter{ $0.topCandidates(1).first?.string==column }
            let rows=observations.filter{ $0.topCandidates(1).first?.string==row }
            // The real row and column header must align with the acknowledged cell value.
            // If headers are hidden or a frozen pane makes identity ambiguous, reject.
            let area=areas.first ?? capture.frame
            let value=found[0]
            let c=columns.filter{let r=rect($0.boundingBox,in:capture.frame);return r.midY>value.midY && r.midY>area.maxY-50 && abs(r.midX-value.midX)<80}
            let r=rows.filter{let r=rect($0.boundingBox,in:capture.frame);return r.midX<value.minX && r.midX<area.minX+65 && abs(r.midY-value.midY)<8}
            guard c.count==1,r.count==1 else{return []}
        }
        return found
    }
    static func signature(_ image:CGImage)->[UInt8]? {
        var pixels=[UInt8](repeating:0,count:32*32*4)
        return pixels.withUnsafeMutableBytes{bytes in
            guard let ctx=CGContext(data:bytes.baseAddress,width:32,height:32,bitsPerComponent:8,bytesPerRow:32*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue) else{return nil}
            ctx.interpolationQuality = .high;ctx.draw(image,in:CGRect(x:0,y:0,width:32,height:32))
            return Array(bytes)
        }
    }
    static func surface(_ locator:[String:Any],capture:Capture,areas:[CGRect],imageFrames:[CGRect]=[])->[CGRect] {
        guard let encoded=locator["image"] as? String,encoded.count<8_000_000,
              let bytes=Data(base64Encoded:encoded),let bitmap=NSBitmapImageRep(data:bytes),let template=bitmap.cgImage,
              let reference=signature(template),let regions=locator["regions"] as? [[String:Double]] else{return []}
        let request=VNDetectRectanglesRequest();request.minimumConfidence=0.85;request.maximumObservations=16
        request.minimumSize=0.08;request.quadratureTolerance=4
        guard (try? VNImageRequestHandler(cgImage:capture.image).perform([request])) != nil else{return []}
        let aspect=CGFloat(template.width)/CGFloat(template.height)
        var candidates:[CGRect]=[]
        let boxes=(request.results ?? []).map{$0.boundingBox}+imageFrames.map{normalized($0,in:capture.frame)}
        for box in boxes {
            let r=rect(box,in:capture.frame)
            guard areas.contains(where:{$0.insetBy(dx:-2,dy:-2).contains(r)}),abs(r.width/r.height-aspect)<aspect*0.025 else{continue}
            let crop=CGRect(x:box.minX*CGFloat(capture.image.width),y:(1-box.maxY)*CGFloat(capture.image.height),width:box.width*CGFloat(capture.image.width),height:box.height*CGFloat(capture.image.height))
            guard let cropped=capture.image.cropping(to:crop),let signature=signature(cropped) else{continue}
            let error=zip(signature,reference).enumerated().filter{$0.offset%4 != 3}.map{abs(Double($0.element.0)-Double($0.element.1))/255}.reduce(0,+)/Double(32*32*3)
            if error<0.035 && !candidates.contains(where:{abs($0.minX-r.minX)<3&&abs($0.minY-r.minY)<3&&abs($0.width-r.width)<3&&abs($0.height-r.height)<3}){candidates.append(r)}
        }
        guard candidates.count==1,let surface=candidates.first else{return []}
        var output:[CGRect]=[]
        for r in regions {
            guard let x=r["x"],let y=r["y"],let w=r["width"],let h=r["height"],x>=0,y>=0,w>0,h>0,x+w<=1,y+h<=1 else{return []}
            output.append(CGRect(x:surface.minX+x*surface.width,y:surface.maxY-(y+h)*surface.height,width:w*surface.width,height:h*surface.height))
        }
        return output
    }
}
