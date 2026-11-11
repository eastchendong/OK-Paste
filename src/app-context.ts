export interface NativeDropContext {
  id:string;host:'word'|'excel'|'powerpoint'|'figma'|'input';windowId:number;
  x:number;y:number;positioned:boolean;capturedAt:number;cellAddress?:string;
}
export interface AppContext {
  appName:string;bundleId:string;windowTitle?:string;documentPath?:string;
  selectedText?:string;focusedText?:string;role?:string;accessibility?:boolean;
  nativeDrop?:NativeDropContext;
  visualContextUnavailable?:string;
  editAnchor?:{markedAt:string;url?:string;range?:{location:number;length:number};bounds?:{x:number;y:number;width:number;height:number}};
}
export function appDisabledReason(focus:AppContext) {
  return ['com.lemon.lvpro','com.lemon.lvoverseas'].includes(focus.bundleId)
    ? '剪映接入暂未启用，内容包已保留。请切换到其他应用后继续。' : '';
}
export function destinationForApp(focus:AppContext) {
  if(appDisabledReason(focus))return 'disabled';
  if(focus.bundleId==='org.blenderfoundation.blender')return 'blender';
  if(['com.microsoft.Word','com.microsoft.Excel','com.microsoft.Powerpoint'].includes(focus.bundleId)&&focus.documentPath)return 'office';
  return 'focused';
}
