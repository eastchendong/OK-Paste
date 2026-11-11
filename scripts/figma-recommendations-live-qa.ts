import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.local','figma-recommendations-live-'+Date.now());fs.mkdirSync(output,{recursive:true,mode:0o700});
process.env.OKPASTE_CLIPBOARD_DIR=path.join(output,'sources');
const {office,agent,store}=await import('./clipboard-serve');
const plan=agent.ensurePlanned.bind(agent);agent.ensurePlanned=()=>{if((agent.status() as {targetKind?:string}).targetKind==='figma-live')plan();};
const scenes={
 character:{frame:'1107 · 角色 · 目标',scene:'vector-character',brief:'参考玻璃瓶照片和旁边瓶子、杯子角色，补充一个同系列玻璃瓶角色。保留软木塞和瓶身轮廓辨识特征。'},
 icon:{frame:'1107 · 图标 · 目标',scene:'vector-icon',brief:'现有收藏和下载两个图标，缺少历史记录图标。补一个同风格历史记录图标，单色线性、圆润描边，不加五官，不重做整套。'},
 empty:{frame:'1107 · 空状态 · 目标',scene:'vector-empty-state',brief:'产品需要搜索无结果的空状态插画，不是断网，也不是系统错误。沿用现有空状态插画风格，不含文案和按钮。'},
} as const;
let armed:keyof typeof scenes|undefined,capture:{sessionId:string;snapshot:any}|undefined,busy=false;
const save=(name:string,value:unknown)=>fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(value,null,2),{mode:0o600});
const select=office.select.bind(office),request=office.request.bind(office);
office.select=(focus,host='word')=>{
 if(host!=='figma'||!armed||focus.windowTitle!=='妥帖 · Figma 矢量测试 · 1030')throw new Error('仅允许指定Figma测试文件');
 return select(focus,host);
};
office.request=async function<T>(sessionId:string,method:string,args:Record<string,unknown>={}):Promise<T>{
 const result:any=await request(sessionId,method,args);
 if(method==='capture'){
  if(!armed||result.document?.name!=='妥帖 · Figma 矢量测试 · 1030'||result.target?.name!==scenes[armed].frame||result.document.items.some((n:any)=>n.parent===result.target.nodeId)){
   await request(sessionId,'release',{anchorId:result.anchorId}).catch(()=>{});throw new Error('目标不是当前指定的空测试画框');
  }
  capture={sessionId,snapshot:result};save(armed+'-before',result);
 }
 if(armed&&['apply','undo'].includes(method))fs.appendFileSync(path.join(output,'mutations.ndjson'),JSON.stringify({scene:armed,method,revision:args.expectedRevision,at:new Date().toISOString()})+'\n');
 return result;
};
const summary=()=>{const s=agent.status();return Object.fromEntries(['phase','targetKind','targetName','revision','canUndo','mutationUncertain','actions','error','result','initialRecommendation','followupRecommendations'].map(k=>[k,(s as any)[k]]));};
async function command(input:any){
 if(input.action==='arm'){
  if(!(input.scene in scenes))throw new Error('未知场景');
  const state=agent.status() as {phase:string;canUndo?:boolean;targetKind?:string};if(['planning','running','preview'].includes(state.phase)||state.canUndo)throw new Error('先完成并撤销上个任务');
  if(state.targetKind==='figma-live')await agent.control('finish');
  store.archive(store.list().map(item=>item.id));armed=input.scene as keyof typeof scenes;capture=undefined;
  store.add({type:'text',source:{title:'独立Figma验收需求 · '+armed},body:{text:scenes[armed].brief}});
  if(armed==='character'){
   const sourceImage=process.env.TUOTIE_QA_BOTTLE;
   if(!sourceImage)throw new Error('缺少指定合成参考照片路径');
   store.add({type:'image',source:{title:'合成玻璃瓶参考照片'},body:{mime:'image/png',dataUrl:'data:image/png;base64,'+fs.readFileSync(sourceImage).toString('base64')}});
  }
  return {armed,expectedFrame:scenes[armed].frame,sourceCount:store.list().length,...summary()};
 }
 if(input.action==='checkpoint'){
  if(!capture||!armed)throw new Error('尚未捕获');
  const snapshot:any=await office.request(capture.sessionId,'read',{anchorId:capture.snapshot.anchorId});
  save(armed+'-'+input.label,{status:agent.status(),snapshot});
  for(const [i,p]of snapshot.previews.entries())fs.writeFileSync(path.join(output,armed+'-'+input.label+'-'+i+'.png'),Buffer.from(p.dataUrl.split(',')[1],'base64'));
  const outsideBefore=capture.snapshot.document.items.filter((n:any)=>n.id!==capture!.snapshot.target.nodeId&&!isDescendant(capture!.snapshot.document.items,n.id,capture!.snapshot.target.nodeId));
  const originalsPreserved=outsideBefore.every((n:any)=>JSON.stringify(n)===JSON.stringify(snapshot.document.items.find((next:any)=>next.id===n.id)));
  const empty=snapshot.document.items.filter((n:any)=>n.parent===snapshot.target.nodeId).length===0;
  return {label:input.label,originalsPreserved,empty,versionRestored:snapshot.version===capture.snapshot.version,...summary()};
 }
 if(input.action==='capture'){
  if(!armed)throw new Error('尚未指定场景');
  const focus={appName:'Figma',bundleId:'com.figma.Desktop',windowTitle:'妥帖 · Figma 矢量测试 · 1030'};
  return agent.beginFigmaPaste(focus,office);
 }
 return summary();
}
function isDescendant(items:any[],id:string,parent:string):boolean{let node=items.find(n=>n.id===id);const seen=new Set();while(node&&!seen.has(node.id)){seen.add(node.id);if(node.parent===parent)return true;node=items.find(n=>n.id===node.parent);}return false;}
const seen=new Set<string>();setInterval(()=>{
 if(busy)return;const file=path.join(output,'command.json');if(!fs.existsSync(file))return;
 let input:any;try{input=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return;}
 if(!input.id||seen.has(input.id))return;seen.add(input.id);busy=true;
 void command(input).then(value=>{save('reply',{id:input.id,...value});console.log(JSON.stringify({id:input.id,...value}));}).catch(error=>{save('reply',{id:input.id,error:error.message});console.log(JSON.stringify({id:input.id,error:error.message}));}).finally(()=>busy=false);
},150);
console.log(JSON.stringify({ready:true,output,realModel:true,realHost:true,uiActions:'performed separately through the native app; capture API is separately labeled when used'}));
