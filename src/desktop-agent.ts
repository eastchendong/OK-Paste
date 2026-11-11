import {OfficeBridge,type DocumentHost,type ExcelSnapshot,type WordSnapshot} from './office-live/bridge';
import {WordLiveTarget} from './targets/word-live';
import {ExcelLiveTarget} from './targets/excel-live';
import {PowerPointLiveTarget,type PowerPointSnapshot} from './targets/powerpoint-live';
import {IllustratorLiveTarget,type IllustratorSnapshot} from './targets/illustrator-live';
import {FigmaLiveTarget,type FigmaSnapshot} from './targets/figma-live';
import {type AppContext,appDisabledReason,destinationForApp} from './app-context';
import type {EditableTarget} from './targets/editable-target';
import {InputLiveTarget,type InputCapture,type InputReceipt,type InputExchange} from './targets/input-live';
import {FocusedText} from './targets/focused-text';
import {nativeDropCapture} from './native-drop';
import fs from 'node:fs';
import path from 'node:path';
import type {ClipboardStore} from './clipboard/store';
import {FileRunner} from './file-runner';
import type {SceneRunner,SceneRunRequest,SceneControl} from './scene-runner';

const liveHosts:Record<string,DocumentHost>={
 'com.microsoft.Word':'word','com.microsoft.Excel':'excel','com.microsoft.Powerpoint':'powerpoint',
 'com.adobe.illustrator':'illustrator','com.figma.Desktop':'figma',
};

/** One shared desktop surface routes the same source bundle to a real target. */
export class DesktopAgent {
 readonly files:FileRunner;
 private selected='blender';
 private notice?:{id:number;text:string};
 private taskBundle:string[]=[];
 private taskArchived=false;
 private focus?:AppContext;private focusRevision=0;private officePath='';
 private officePaste=false;
 private pasteHadSources=false;
 private endingEmptyTask?:Promise<void>;
 private preparingPackDrag=false;
 private inputTarget?:InputLiveTarget;
 private anchor?:AppContext;private planningFocus?:AppContext;
 private focusChain:Promise<unknown>=Promise.resolve();
 private blenderPasteCapture?:{revision:number;focus:AppContext};
 private usedNativeDrops=new Set<string>();
 private pendingNativeDrop?:{id:string;cancelled:boolean;focus:AppContext};
 constructor(private root:string,private scenes:SceneRunner,private store:ClipboardStore,private copyPreparedText:(text:string)=>void){
  this.files=new FileRunner(root,store,()=>{if(!this.officePaste)this.archiveAppliedTask();});
  scenes.onDrop=()=>{
   if(this.blenderPasteCapture)return false;
   if(this.officePaste){this.notice={id:Date.now(),text:'请先结束当前任务，再把内容框拖到新的位置'};return false;}
   if(this.selected==='blender')return true;
   if(['running','preview'].includes(this.active.phase)){
    this.notice={id:Date.now(),text:'请先应用或取消当前预览，再拖入新的目标'};return false;
   }
   if(this.active.phase==='planning')void this.active.control('cancel');
   this.selected='blender';return true;
  };
 }
 private archiveAppliedTask(){this.store.archive(this.taskBundle);this.taskBundle=[];this.taskArchived=true;}
 private get active(){return this.selected==='blender'?this.scenes:this.files;}
 private get managed(){return ['blender','office','focused'].includes(this.selected);}
 status(){
  if(this.pendingNativeDrop)return {phase:'planning' as const,destinationId:'office',targetName:this.pendingNativeDrop.focus.appName,actions:[],pendingDrop:null,canUndo:false,step:'正在读取拖放位置',anchor:undefined,focus:this.pendingNativeDrop.focus,foregroundFocus:this.focus};
  if(this.blenderPasteCapture)return {phase:'planning',destinationId:'blender',targetName:'Blender',actions:[],pendingDrop:null,canUndo:false,needsClarification:false,step:'读取三维视口中心',focus:this.blenderPasteCapture.focus,foregroundFocus:this.focus};
  if(this.selected==='disabled')return {phase:'idle',destinationId:'disabled',targetKind:'disabled',targetName:this.planningFocus?.appName||'当前应用',unavailableReason:this.planningFocus?appDisabledReason(this.planningFocus):'此应用暂未启用',actions:[],pendingDrop:null,canUndo:false,notice:this.notice,focus:this.planningFocus,foregroundFocus:this.focus};
  if(!this.managed)return {phase:'idle',destinationId:this.selected,targetName:this.selected==='hold'?'留在妥帖':'系统剪贴板',actions:[],pendingDrop:null,notice:this.notice,anchor:this.anchor,focus:this.planningFocus,foregroundFocus:this.focus};
  return {...this.active.status(),destinationId:this.selected,targetName:this.selected==='blender'?'Blender':this.files.targetName,focus:this.planningFocus,foregroundFocus:this.focus,anchor:this.anchor,taskArchived:this.taskArchived,notice:this.notice};
 }
 ensurePlanned():void|Promise<void>{
  if(this.blenderPasteCapture)return;
  if(this.endingEmptyTask)return this.endingEmptyTask;
  const hasSources=this.store.list().length>0;
  if(this.officePaste&&hasSources)this.pasteHadSources=true;
  const status=this.files.status();
  if(this.officePaste&&this.pasteHadSources&&!hasSources&&['idle','planning','ready','error'].includes(this.files.phase)&&!status.canUndo&&!status.mutationUncertain){
   this.endingEmptyTask=this.control('finish').then(result=>{
    if(!result.ok)throw new Error(result.error||'结束任务失败');
   }).catch(error=>{this.notice={id:Date.now(),text:error instanceof Error?error.message:'结束任务失败'};}).finally(()=>{this.endingEmptyTask=undefined;});
   return this.endingEmptyTask;
  }
  if(this.taskArchived||this.officePaste&&this.files.phase==='done')return;
  if(this.managed)this.active.ensurePlanned();
 }
 run(input:SceneRunRequest){
  if(this.pendingNativeDrop)return {ok:false,error:'正在读取拖放位置，请稍候'};
  if(this.preparingPackDrag)return {ok:false,error:'正在准备内容拖放，请稍候'};
  if(this.blenderPasteCapture)return {ok:false,error:"正在读取三维视口中心，请稍候"};
  if(this.selected==='disabled')return {ok:false,error:this.status().unavailableReason};
  if(this.endingEmptyTask)return {ok:false,error:'正在结束空内容包任务，请稍候'};
  if(input.destinationId&&input.destinationId!==this.selected)return {ok:false,error:'目标已改变，请查看当前推荐后再开始'};
  if(this.selected==='focused' && this.planningFocus && liveHosts[this.planningFocus.bundleId] && !this.inputTarget){
   return {ok:false,error:'请在文稿中选择编辑位置，再按 ⌥⌘V 直接写入'};
  }
  if(!this.managed)return {ok:false,error:'请先选择可执行的目标'};
  const continuation=this.active.phase==='preview'||Boolean(input.continuation);
  const result=this.active.run(input);
  if(result.ok){
   const used=input.itemIds??(input.itemId?[input.itemId]:[]);
   this.taskBundle=continuation?[...new Set([...this.taskBundle,...used])]:this.inputTarget&&input.itemIds?used:this.store.list().map(item=>item.id);
   this.taskArchived=false;
  }
  return result;
 }
 async control(action:SceneControl){
  if(this.pendingNativeDrop&&['cancel','finish'].includes(action)){this.pendingNativeDrop.cancelled=true;return {ok:true};}
  if(this.blenderPasteCapture){
   if(action!=='cancel')return {ok:false,error:'正在读取三维视口中心，请稍候'};
   await this.cancelBlenderPasteCapture();
   if(this.focus)await this.updateFocus(this.focus,true);
   return {ok:true};
  }
  if(this.selected==='focused' && this.planningFocus && liveHosts[this.planningFocus.bundleId] && !this.inputTarget){
   return {ok:false,error:'请在文稿中选择编辑位置，再按 ⌥⌘V 直接写入'};
  }
  if(!this.managed)return {ok:false,error:'请先选择可执行的目标'};
  if(action==='commit'&&this.selected!=='blender'&&this.files.phase==='preview'&&this.files.status().targetKind==='focused-text'){
   try{this.copyPreparedText(this.files.status().previewText);}catch(error){return {ok:false,error:error instanceof Error?error.message:'系统复制失败，请重试'};}
  }
  const finishApplied=action==='finish'&&this.officePaste&&this.files.phase==='done';
  const nextFile=action==='finish'&&!this.officePaste&&this.selected==='office'?this.officePath:'';
  const result=await this.active.control(action);
  if(result.ok&&(finishApplied||action==='commit'&&!this.officePaste)){
   this.archiveAppliedTask();
  }else if(result.ok&&['cancel','finish','undo'].includes(action)&&!(['cancel','undo'].includes(action)&&this.active.phase==='done')){this.taskBundle=[];this.taskArchived=false;}
  const endedPaste=result.ok&&this.officePaste&&['cancel','undo'].includes(action)&&this.active.phase!=='done'&&!this.files.status().canUndo;
  if(endedPaste)await this.files.control('finish');
  if(result.ok&&(action==='finish'||endedPaste)){
   this.inputTarget=undefined;this.officePaste=false;this.anchor=undefined;
   if(this.focus)await this.updateFocus(this.focus,true);
   // A selected saved file stays available for the next package. Live ranges
   // still require a new shortcut capture after their task has been released.
   else if(nextFile){await this.files.select(nextFile);this.ensurePlanned();}
  }
  else if(result.ok&&['cancel','undo'].includes(action)&&this.focus&&!this.anchor)await this.updateFocus(this.focus,true);
  return result;
 }
 supplement(instruction:string){return this.managed?this.active.supplement(instruction):{ok:false,error:'请先选择可执行的目标'};}
 async preparePackDrag(){
  if(this.preparingPackDrag||this.endingEmptyTask||this.blenderPasteCapture||this.pendingNativeDrop)return {ok:false,error:'正在切换任务，请稍后再拖动内容框'};
  if(!this.store.list().length)return {ok:false,error:'内容框中没有可拖动的资料'};
  const status=this.status();
  if(['running','preview','done'].includes(status.phase)||status.canUndo||'mutationUncertain' in status&&status.mutationUncertain||
     this.officePaste&&((this.files.status().revision??0)>0||Boolean(this.files.status().previewText)))
   return {ok:false,error:'请先处理并结束当前任务，再把内容框拖到新的位置'};
  if(!this.officePaste)return {ok:true};
  // A physical drag explicitly chooses a new target. Release only a capture
  // that has never produced a draft or write; keep every source in the bundle.
  this.preparingPackDrag=true;
  try{return await this.control('finish');}
  finally{this.preparingPackDrag=false;}
 }
 async cancelNativeDrop(id:string){
  if(this.pendingNativeDrop?.id===id){this.pendingNativeDrop.cancelled=true;return {ok:true};}
  if(this.anchor?.nativeDrop?.id!==id)return {ok:true};
  const status=this.status();
  if(status.canUndo||'mutationUncertain' in status&&status.mutationUncertain||['running','preview','done'].includes(status.phase)||this.files.status().previewText)
   return {ok:false,error:'本次落点已有任务结果，请先处理并结束任务'};
  return this.control('finish');
 }
 dismissDrop(eventId?:string){
  const result=this.selected==='blender'?this.scenes.dismissDrop(eventId):{ok:true};
  if(this.focus&&!this.scenes.status().pendingDrop)void this.updateFocus(this.focus,true);
  return result;
 }
 async selectTarget(input:{id:string;path?:string}){
  await this.cancelBlenderPasteCapture();
  this.requireNewPaste();
  if(!['blender','office','system','hold'].includes(input.id))throw new Error('没有这个目标');
  if(input.id===this.selected&&input.id!=='office')return {ok:true,id:this.selected,name:input.id};
  if(this.active.phase==='planning')await this.active.control('cancel');
  if(['running','preview'].includes(this.active.phase))throw new Error('请先应用或取消当前任务，再更换目标');
  if(input.id==='office'){
   if(!input.path)throw new Error('请选择目标文件');
   await this.files.select(input.path);this.officePath=input.path;
  }
  this.selected=input.id;this.officePaste=false;
  this.anchor=undefined;
  this.taskArchived=false;this.taskBundle=[];
  fs.mkdirSync(path.join(this.root,'.local'),{recursive:true});
  fs.writeFileSync(path.join(this.root,'.local','target-selection.json'),JSON.stringify({id:this.selected,path:input.path}));
  this.ensurePlanned();return {ok:true,id:this.selected,name:this.selected==='office'?this.files.targetName:input.id};
 }
 private async beginLivePaste<T extends {anchorId:string}>(focus:AppContext,bridge:OfficeBridge,host:DocumentHost,makeTarget:(session:string,snapshot:T)=>EditableTarget){
  if(liveHosts[focus.bundleId]!==host)throw new Error('请在目标应用中选择编辑位置后按 ⌥⌘V');
  if(!this.store.list().length)throw new Error('请先向内容包添加参考内容');
  const captureArgs=nativeDropCapture(focus,host);
  return this.pinPaste(focus,'office',async()=>{
   const session=bridge.select(focus,host);
   const snapshot=await bridge.request<T>(session,'capture',captureArgs);
   try{return makeTarget(session,snapshot);}
   catch(error){await bridge.request(session,'release',{anchorId:snapshot.anchorId}).catch(()=>{});throw error;}
  });
 }
 beginInputPaste(capture:InputCapture){
  nativeDropCapture(capture.focus,'input');
  if(capture.focus.nativeDrop&&!capture.focus.nativeDrop.positioned&&!capture.manual)throw new Error('未绑定落点输入框，只能复制生成文字');
  const target=new InputLiveTarget(capture,this.copyPreparedText);
  return this.pinPaste(capture.focus,'focused',async()=>target);
 }
 exchangeInput(id:string,receipt?:InputReceipt):InputExchange{
  return this.inputTarget?.exchange(id,receipt)??{active:false};
 }
 private async pinPaste(focus:AppContext,destination:string,capture:()=>Promise<EditableTarget>){
  if(appDisabledReason(focus))throw new Error(appDisabledReason(focus));
  await this.endingEmptyTask;
  this.requireNewPaste();
  if(focus.nativeDrop){
   if(this.usedNativeDrops.has(focus.nativeDrop.id))throw new Error('此拖放已处理，请重新拖入');
   this.usedNativeDrops.add(focus.nativeDrop.id);
   if(this.usedNativeDrops.size>100)this.usedNativeDrops.delete(this.usedNativeDrops.values().next().value!);
  }
  if(['running','preview'].includes(this.active.phase))throw new Error('请先完成当前任务');
  this.officePaste=true;this.pasteHadSources=this.store.list().length>0;++this.focusRevision;
  const drop=focus.nativeDrop?{id:focus.nativeDrop.id,cancelled:false,focus}:undefined;
  if(drop)this.pendingNativeDrop=drop;
  let target:EditableTarget|undefined;
  try{
   await this.focusChain;
   if(drop?.cancelled)throw new Error('本次拖放已取消');
   target=await capture();
   if(drop?.cancelled)throw new Error('本次拖放已取消');
   await this.files.useTarget(target);
   if(drop?.cancelled){await this.files.control('finish');throw new Error('本次拖放已取消');}
  }catch(error){await target?.dispose?.().catch(()=>{});this.officePaste=false;throw error;}
  finally{if(this.pendingNativeDrop===drop)this.pendingNativeDrop=undefined;}
  this.inputTarget=target instanceof InputLiveTarget?target:undefined;
  this.anchor=focus;this.planningFocus=focus;this.selected=destination;this.taskArchived=false;this.taskBundle=[];
  this.ensurePlanned();return {ok:true};
 }
 beginWordPaste(focus:AppContext,bridge:OfficeBridge){
  return this.beginLivePaste<WordSnapshot>(focus,bridge,'word',(session,snapshot)=>
   new WordLiveTarget(bridge,session,focus.windowTitle||'Word 文稿',snapshot,this.store));
 }
 beginExcelPaste(focus:AppContext,bridge:OfficeBridge){
  return this.beginLivePaste<ExcelSnapshot>(focus,bridge,'excel',(session,snapshot)=>
   new ExcelLiveTarget(bridge,session,`${snapshot.worksheet} · ${snapshot.selection.address.split('!').at(-1)}`,snapshot));
 }
 beginPowerPointPaste(focus:AppContext,bridge:OfficeBridge){
  return this.beginLivePaste<PowerPointSnapshot>(focus,bridge,'powerpoint',(session,snapshot)=>
   new PowerPointLiveTarget(this.root,bridge,session,`${focus.windowTitle||'PowerPoint'} · 第 ${snapshot.slideIndex+1} 页`,snapshot,this.store));
 }
 beginIllustratorPaste(focus:AppContext,bridge:OfficeBridge){
  return this.beginLivePaste<IllustratorSnapshot>(focus,bridge,'illustrator',(session,snapshot)=>
   new IllustratorLiveTarget(this.root,bridge,session,`${snapshot.document.name} · ${snapshot.target.name}`,snapshot));
 }
 beginFigmaPaste(focus:AppContext,bridge:OfficeBridge){
  return this.beginLivePaste<FigmaSnapshot>(focus,bridge,'figma',(session,snapshot)=>
   new FigmaLiveTarget(this.root,bridge,session,`${snapshot.document.name} · ${snapshot.target.name}`,snapshot));
 }
 private requireNewPaste(){
  if(this.preparingPackDrag)throw new Error('正在准备内容拖放，请稍候');
  if(this.blenderPasteCapture)throw new Error('正在读取三维视口中心，请稍候');
  if(this.officePaste)throw new Error('本次任务仍使用原位置。请先在妥帖结束任务，再到新位置按 ⌥⌘V');
 }
 async beginBlenderPaste(focus:AppContext){
  this.requireNewPaste();
  if(focus.bundleId!=='org.blenderfoundation.blender')throw new Error('请在 Blender 三维视口中按 ⌥⌘V');
  if(['running','preview'].includes(this.active.phase))throw new Error('请先完成或取消当前任务');
  if(!this.store.list().length)throw new Error('请先向内容包添加参考内容');
  const reservation={revision:++this.focusRevision,focus};this.blenderPasteCapture=reservation;
  this.focus??=focus;
  const check=()=>{if(this.blenderPasteCapture!==reservation||reservation.revision!==this.focusRevision)throw new Error('本次位置捕获已取消，请重新按 ⌥⌘V');};
  try{
   await this.focusChain;check();
   if(['running','preview'].includes(this.active.phase))throw new Error('请先完成或取消当前任务');
   if(this.selected!=='blender'&&this.active.phase==='planning'){await this.active.control('cancel');check();}
   const result=await this.scenes.beginPaste(focus);check();
   this.planningFocus=focus;this.selected='blender';this.anchor=undefined;
   this.taskArchived=false;this.taskBundle=[];
   return result;
  }finally{if(this.blenderPasteCapture===reservation)this.blenderPasteCapture=undefined;}
 }
 private async cancelBlenderPasteCapture(){
  if(!this.blenderPasteCapture)return;
  this.blenderPasteCapture=undefined;++this.focusRevision;
  this.scenes.cancelPasteCapture();this.scenes.dismissDrop();
  await this.scenes.control('cancel');
 }
 async markAnchor(focus:AppContext|null){
  await this.cancelBlenderPasteCapture();
  this.requireNewPaste();
  if(focus&&appDisabledReason(focus))return {ok:false,error:appDisabledReason(focus)};
  if(['running','preview'].includes(this.active.phase)||this.taskArchived)return {ok:false,error:'请先完成当前任务，再标记修改位置'};
  if(focus&&(!focus.bundleId||!focus.appName||!focus.editAnchor))return {ok:false,error:'请选择要修改的位置'};
  this.anchor=focus??undefined;
  const target=focus??this.focus;
  if(target)await this.routeFocus(target);
  return {ok:true};
 }
 async updateFocus(focus:AppContext,force=false){
  if(!focus.bundleId||!focus.appName)return {ok:false,error:'聚焦应用无效'};
  if(!force&&JSON.stringify(this.focus)===JSON.stringify(focus)&&(this.anchor||JSON.stringify(this.planningFocus)===JSON.stringify(focus)))return {ok:true};
  this.focus=focus;
  if(this.blenderPasteCapture){if(!force)return {ok:true};await this.cancelBlenderPasteCapture();}
  // An in-flight task keeps its own target. New recommendations follow focus
  // after the result is handled, rather than retargeting a running edit.
  if(['running','preview'].includes(this.active.phase)||this.taskArchived&&!force)return {ok:true};
  if(this.officePaste||this.anchor&&!force)return {ok:true};
  if(this.selected==='blender'&&this.scenes.status().pendingDrop&&!force)return {ok:true};
  return this.routeFocus(this.anchor??focus);
 }
 private routeFocus(focus:AppContext){
  const revision=++this.focusRevision;
  const operation=this.focusChain.then(async()=>{
  if(revision!==this.focusRevision)return {ok:true};
  if(this.active.phase==='planning')await this.active.control('cancel');
  let destination=destinationForApp(focus);
  if(destination==='office'&&focus.documentPath!==this.officePath)destination='focused';
  if(destination==='blender'){
   this.scenes.updateFocusContext(focus);
  }else if(destination==='disabled'){
   // Do not start MCP, plan generic text, or register a draft for a disabled app.
   await this.files.control('finish');
  }else if(destination==='office'&&focus.documentPath){
   await this.files.select(focus.documentPath);
  }else{
   await this.files.useTarget(new FocusedText(this.root,focus));
  }
  if(revision!==this.focusRevision)return {ok:true};
  this.planningFocus=focus;this.selected=destination;this.taskArchived=false;this.taskBundle=[];this.ensurePlanned();return {ok:true,destinationId:destination};
  });
  this.focusChain=operation.catch(()=>{});return operation;
 }
 async restoreTarget(){
  try{
   const saved=JSON.parse(fs.readFileSync(path.join(this.root,'.local','target-selection.json'),'utf8'));
   if(saved.id==='office'&&typeof saved.path==='string'){await this.files.select(saved.path);this.officePath=saved.path;this.selected='office';}
   else if(['blender','system','hold'].includes(saved.id))this.selected=saved.id;
  }catch(error){
   if(fs.existsSync(path.join(this.root,'.local','target-selection.json'))){this.selected='system';this.notice={id:Date.now(),text:'未能恢复目标文件，请重新选择'};}
  }
 }
 async shutdown(){await Promise.all([this.scenes.shutdown(),this.files.shutdown()]);}
}
