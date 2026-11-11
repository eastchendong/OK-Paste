import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import type {DocumentHost} from '../src/office-live/bridge';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.local',`four-platform-qa-${Date.now()}`);fs.mkdirSync(output,{recursive:true,mode:0o700});
process.env.OKPASTE_CLIPBOARD_DIR=path.join(output,'sources');
const {office,agent,store}=await import('./clipboard-serve');
const plan=agent.ensurePlanned.bind(agent);
const targetKind=()=> (agent.status()as {targetKind?:string}).targetKind||'';
agent.ensurePlanned=()=>{if(targetKind().endsWith('-live'))plan();};
let armed='',busy=false;const captures=new Map<string,{sessionId:string;snapshot:any}>();
const save=(name:string,data:unknown)=>fs.writeFileSync(path.join(output,name),JSON.stringify(data,null,2),{mode:0o600});
const emit=(data:unknown)=>{save('reply.json',data);console.log(JSON.stringify(data));};
const select=office.select.bind(office),request=office.request.bind(office);
office.select=(focus,host='word')=>{
 if(host!==armed)throw new Error('验收仅允许当前指定的独立测试稿');
 if(host==='word'&&focus.windowTitle!=='文档3')throw new Error('Word 仅允许合成文档3');
 if(host==='figma'&&focus.windowTitle!=='妥帖 · Figma 矢量测试 · 1030')throw new Error('Figma 仅允许独立测试文件');
 if(host==='excel'&&!focus.documentPath?.includes('/excel-revision-check-20261103/'))throw new Error('Excel 仅允许独立修订测试稿');
 if(host==='powerpoint'&&!focus.documentPath?.includes('/ppt-revision-check-20261103/'))throw new Error('PPT 仅允许独立修订测试稿');
 return select(focus,host);
};
office.request=async function<T>(sessionId:string,method:string,args:Record<string,unknown>={}):Promise<T>{
 const result:any=await request(sessionId,method,args);
 if(method==='capture'){
  const valid=armed==='word'?result.body?.startsWith('妥帖固定位置流程验收'):armed==='figma'?result.target?.name==='04 · 修订验收':armed==='excel'?JSON.stringify(result.workbook).includes('妥帖 Excel 修订验收'):armed==='powerpoint'&&result.slideIndex===0;
  if(!valid){await request(sessionId,'release',{anchorId:result.anchorId}).catch(()=>{});throw new Error('选区不是指定测试目标，未交给模型或写入');}
  captures.set(armed,{sessionId,snapshot:result});save(`${armed}-before.json`,result);emit({event:'captured',host:armed});
 }
 if(['insert','apply','undo'].includes(method)){
  fs.appendFileSync(path.join(output,'mutations.ndjson'),JSON.stringify({host:armed,method,revision:args.expectedRevision,at:new Date().toISOString()})+'\n');
 }
 return result;
};
function status(){const x=agent.status();return Object.fromEntries(['phase','targetKind','targetName','targetLocation','revision','canUndo','mutationUncertain','actions','error','result'].map(key=>[key,(x as any)[key]]));}
async function command(input:any){
 if(input.action==='arm'){
  if(!['word','powerpoint','excel','figma'].includes(input.host))throw new Error('未知测试平台');
  if(['running','planning','preview'].includes(agent.status().phase))throw new Error('先完成或停止当前验收任务');
  if(targetKind().endsWith('-live'))await agent.control('finish');
  store.archive(store.list().map(item=>item.id));armed=input.host;captures.delete(armed);
  const text=armed==='excel'?'甲的基础数量120，计算列使用基础数量乘2，乙保留20；仅更新保存的选区。':armed==='figma'?'参考旁边已有作品，制作圆润的浅蓝色小瓶子角色，深蓝描边、软木塞、眼睛、微笑和短手脚。':'校园阅读活动：11月15日14:00至16:00在图书馆举办，招募12名学生志愿者，负责签到、引导和图书整理。';
  store.add({type:'text',source:{title:'四平台独立验收资料'},body:{text}});
  if(armed==='powerpoint')for(const name of ['source-a','source-b'])store.add({type:'image',source:{title:name},body:{dataUrl:'data:image/png;base64,'+fs.readFileSync(path.join(root,'.local/ppt-revision-check-20261103',name+'.png')).toString('base64')}});
  return {armed,sourceCount:store.list().length,...status()};
 }
 if(input.action==='checkpoint'){
  const saved=captures.get(armed);if(!saved)throw new Error('尚未捕获目标');
  const snapshot=await office.request(saved.sessionId,'read',{anchorId:saved.snapshot.anchorId});save(`${armed}-${input.label}.json`,snapshot);return {label:input.label,...status()};
 }
 if(input.action==='note'){save(`${armed}-${input.label}-note.json`,input);return {noted:input.label};}
 return status();
}
const seen=new Set<string>();
setInterval(()=>{
 if(busy)return;const file=path.join(output,'command.json');if(!fs.existsSync(file))return;
 let input:any;try{input=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return;}
 if(!input.id||seen.has(input.id))return;seen.add(input.id);busy=true;
 void command(input).then(value=>emit({id:input.id,...value})).catch(error=>emit({id:input.id,error:error.message})).finally(()=>busy=false);
},200);
emit({event:'ready',output,instructions:'write unique-id commands to command.json; interact with the actual desktop application; no UI simulation or model substitution'});
