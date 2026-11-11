// Concatenated after NativePackDrop.swift for a non-interactive component check.
func check(_ condition: Bool, _ message: String) {
    if !condition { fputs(message+"\n",stderr);exit(1) }
}
MainActor.assumeIsolated {
_ = NSApplication.shared
check(NativeDropGeometry.quartz(NSPoint(x:-450,y:-120),primaryTop:900)==CGPoint(x:-450,y:1020),"negative-screen conversion failed")
let frame=CGRect(x:-1200,y:900,width:1000,height:800)
check(NativeDropGeometry.cocoa(frame,primaryTop:900)==CGRect(x:-1200,y:-800,width:1000,height:800),"window coordinates must use points")
check(NativeDropGeometry.valid(frame:frame,point:CGPoint(x:-400,y:1100)),"valid negative-screen point rejected")
check(!NativeDropGeometry.valid(frame:frame,point:CGPoint(x:0,y:1100)),"outside window accepted")
check(!NativeDropGeometry.valid(frame:.zero,point:.zero),"zero-size target accepted")
check(NativeDropGeometry.host("com.microsoft.Word")=="word","Word routing")
check(NativeDropGeometry.host("com.microsoft.Excel")=="excel","Excel routing")
check(NativeDropGeometry.host("com.microsoft.Powerpoint")=="powerpoint","PowerPoint routing")
check(NativeDropGeometry.host("com.figma.Desktop")=="figma","Figma routing")
check(NativeDropGeometry.host("com.tencent.xinWeChat")=="input","general routing")
check(NativeDropGeometry.host("org.blenderfoundation.blender")==nil,"must preserve Blender native FileHandler")
let panel=DropPanel(contentRect:CGRect(x:0,y:0,width:400,height:300),styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
check(!panel.canBecomeKey && !panel.canBecomeMain,"drop receiver must not steal keyboard focus")
panel.close()
let receiver=NativePackDrop()
check(receiver.finish(id:"cancelled",accepted:false,at:.zero)==nil,"cancelled drag created a target")
receiver.stop();receiver.stop()
print("Native drop: geometry, routing, non-key panel and repeatable cleanup passed; no host interactions performed.")
}
