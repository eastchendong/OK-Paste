import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {ClipboardStore} from '../src/clipboard/store';import {FileRunner} from '../src/file-runner';
import {ExcelLiveTarget} from '../src/targets/excel-live';import {FigmaLiveTarget,type FigmaSnapshot} from '../src/targets/figma-live';
import type {ExcelSnapshot} from '../src/office-live/bridge';

// Deliberate live acceptance harness. Use only isolated fixtures, instead of the
// normal backend; collected sources are separate from the user's content pack.
const [host,documentName,frameName]=process.argv.slice(2);
if(host!=='excel'&&host!=='figma')throw new Error('指定 excel 或 figma；不要与常规服务同时启动');
if(host==='excel'&&(!path.isAbsolute(documentName||'')||!path.basename(path.dirname(documentName)).startsWith('excel-revision-check-')))throw new Error('Excel 只接受 excel-revision-check-* 目录中的独立合成稿');
if(host==='figma'&&(!documentName?.startsWith('妥帖 · Figma 矢量测试')||!frameName?.startsWith('04 · 修订验收')))throw new Error('Figma 只接受指定测试文件中的 04 · 修订验收空画框');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),output=path.join(root,'.local',`${host}-revisions-${Date.now()}`);
fs.mkdirSync(output,{recursive:true,mode:0o700});
const save=(name:string,value:unknown)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2),{mode:0o600});
const stage=(name:string,detail:Record<string,unknown>={})=>{save('stage.json',{stage:name,...detail});console.log(JSON.stringify({stage:name,output,...detail}));};
const {office}=await import('./clipboard-serve');
const store=new ClipboardStore(path.join(output,'sources'));let runner:FileRunner|undefined,sessionId='',anchorId='';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const outside=(snapshot:ExcelSnapshot)=>{const workbook=structuredClone(snapshot.workbook);for(const sheet of workbook.sheets)if(sheet.name==='数据'&&sheet.usedRange)for(const key of ['formulas','text','numberFormat']as const)for(const r of [1,2])for(const c of [1,2])(sheet.usedRange[key] as unknown[][])[r][c]=null;return workbook;};
const tree=(snapshot:FigmaSnapshot)=>{const children=(parent:string):unknown[]=>snapshot.document.items.filter((item:any)=>item.parent===parent).map((item:any)=>{const {id,parent,...rest}=item;return {...rest,children:children(id)};});return children(snapshot.target.nodeId);};
try{
 if(process.env.OKPASTE_CHECK_WAIT==='1'){
  stage('waiting-for-start');const readyDeadline=Date.now()+600000;
  while(!fs.existsSync(path.join(output,'start'))&&Date.now()<readyDeadline)await delay(500);
  if(!fs.existsSync(path.join(output,'start')))throw new Error('尚未开始验收，未捕获或修改目标');
 }
 stage('waiting-for-fixture');const deadline=Date.now()+180000;
 while(!sessionId&&Date.now()<deadline){try{sessionId=office.select({appName:host,bundleId:host==='excel'?'com.microsoft.Excel':'com.figma.Desktop',...(host==='excel'?{documentPath:documentName}:{windowTitle:documentName})},host);}catch{await delay(500);}}
 if(!sessionId)throw new Error('独立测试稿加载项尚未连接');
 const captured=await office.request<ExcelSnapshot&FigmaSnapshot>(sessionId,'capture');anchorId=captured.anchorId;save('before.json',captured);
 let target:ExcelLiveTarget|FigmaLiveTarget;
 if(host==='excel'){
  if(!JSON.stringify(captured.workbook).includes('妥帖 Excel 修订验收')||!captured.selection.address.endsWith('!B2:C3'))throw new Error('不是指定合成稿 B2:C3，未写入');
  target=new ExcelLiveTarget(office,sessionId,'Excel 合成修订验收',captured);
 }else{
  if(captured.document.name!==documentName||captured.target.name!==frameName||tree(captured).length)throw new Error('不是指定空画框，未写入');
  target=new FigmaLiveTarget(root,office,sessionId,'Figma 合成修订验收',captured);
 }
 const source=store.add({type:'text',source:{title:'独立合成验收资料'},body:{text:host==='excel'?'验收数据：甲的基础数量120，第二列用公式乘2；乙的基础栏是纯文字“=待核对”，第二列0。':'参考现有系列的圆润造型和深色描边，生成浅蓝色玻璃瓶角色，有软木塞、两只眼睛、微笑和短手脚。'}});
 runner=new FileRunner(root,store);await runner.useTarget(target);
 runner.ensurePlanned();const planningDeadline=Date.now()+180000;
 while(runner.phase==='planning'&&Date.now()<planningDeadline)await delay(500);
 if(!['ready','error'].includes(runner.phase))throw new Error('默认推荐阶段未结束');
 const settle=async()=>{const deadline=Date.now()+(host==='figma'?720000:240000);while(['running','planning'].includes(runner!.phase)&&Date.now()<deadline)await delay(500);if(runner!.phase!=='done')throw new Error(runner!.status().error||'模型未完成并写入');};
 const read=()=>office.request<ExcelSnapshot&FigmaSnapshot>(sessionId,'read',{anchorId});
 stage('captured');
 if(!runner.run({itemIds:[source.id],instruction:host==='excel'?'按合成资料更新选区B2:C3：B2为120，C2用公式=B2*2，B3纯文字“=待核对”，C3为0；保留其他位置及格式。':'在空白目标画框生成资料中的浅蓝色玻璃瓶角色，参考现有系列画框风格，保持其他画框不变。',actionIndex:0}).ok)throw new Error('第一轮未开始');
 await settle();if(target.revision!==1)throw new Error('第一版没有写入');const first=await read();save('first.json',first);stage('first-written');
 runner.run({itemIds:[source.id],instruction:host==='excel'?'只把本任务B2改成150，C2改成公式=B2*3，保留B3纯文字“=待核对”和C3的0；提供完整选区版本。':'仅把本任务瓶身配色改成浅绿色，保留其他部件、比例与参考风格；提供完整新版，并检查实际预览。',actionIndex:0,continuation:true});
 await settle();if(Number(target.revision)!==2)throw new Error('第二版没有写入');const second=await read();save('second.json',second);stage('second-written');
 await runner.control('undo');const restoredFirst=await read();save('restored-first.json',restoredFirst);
 await runner.control('undo');await runner.control('cancel');const restored=await read();save('restored-original.json',restored);
 const firstRestored=host==='excel'?same(restoredFirst.selection,first.selection):same(tree(restoredFirst),tree(first));
 const originalRestored=host==='excel'?same(restored.workbook,captured.workbook)&&same(restored.selection,captured.selection):restored.version===captured.version;
 const originalsPreserved=host==='excel'?same(outside(captured),outside(first))&&same(outside(captured),outside(second)):captured.document.items.every((item:any)=>same(item,second.document.items.find((next:any)=>next.id===item.id)));
 const literalPreserved=host==='excel'?first.selection.formulas[1][0]==='=待核对'&&first.selection.formulaMask?.[1][0]===false:true;
 const report={host,revisions:2,firstRestored,originalRestored,originalsPreserved,literalPreserved,physicalShortcut:false,realModel:true,realHost:true};save('report.json',report);
 if(!firstRestored||!originalRestored||!originalsPreserved||!literalPreserved)throw new Error('恢复或原内容保护检查失败，请检查独立测试稿');stage('complete',report);
}catch(error){stage('failed',{error:error instanceof Error?error.message:String(error)});}
finally{
 if(runner){await runner.control('cancel').catch(()=>{});while(runner.status().canUndo)await runner.control('undo');await runner.shutdown();}
 else if(anchorId)await office.request(sessionId,'release',{anchorId}).catch(()=>{});
}
