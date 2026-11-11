import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import type {FigmaSnapshot} from '../src/targets/figma-live';

// Explicit live-editor check. Run instead of clipboard-serve, with no active
// task. It starts the same backend and touches only the named empty test frame.
const [documentName,frameName,svgFile]=process.argv.slice(2);
if(!documentName||!frameName||!svgFile)throw new Error('用法：tsx scripts/figma-live-check.ts <独立测试文件名> <空白目标画框名> <已校验的本机 SVG>');
const svg=fs.readFileSync(svgFile,'utf8'),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.local',`figma-native-check-${Date.now()}`);fs.mkdirSync(output,{recursive:true,mode:0o700});
const save=(name:string,value:unknown)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2),{mode:0o600});
const hash=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const {office}=await import('./clipboard-serve');
let sessionId='',anchorId='',resultId='',undone=false;
try{
 const deadline=Date.now()+120000;
 while(!sessionId&&Date.now()<deadline){try{sessionId=office.select({appName:'Figma',bundleId:'com.figma.Desktop',windowTitle:documentName},'figma');}catch{await delay(500);}}
 if(!sessionId)throw new Error('测试文件的 Figma 插件尚未连接');
 const before=await office.request<FigmaSnapshot>(sessionId,'capture');anchorId=before.anchorId;
 if(before.document.name!==documentName||before.target.name!==frameName)throw new Error('文件或目标画框不是指定测试目标，未写入');
 const beforeItems=before.document.items as Record<string,unknown>[];
 if(beforeItems.some(item=>item.parent===before.target.nodeId))throw new Error('测试目标画框必须为空，未写入');
 save('before.json',before);
 const applied=await office.request<{resultId:string}>(sessionId,'apply',{anchorId,expectedVersion:before.version,expectedRevision:0,taskId:crypto.randomUUID(),svg,summary:'开发验证 · 玻璃瓶角色',replaceResultId:''});resultId=applied.resultId;
 const after=await office.request<FigmaSnapshot>(sessionId,'read',{anchorId});save('after.json',after);
 const afterItems=after.document.items as Record<string,unknown>[];
 const originalsPreserved=beforeItems.every(item=>hash(item)===hash(afterItems.find(next=>next.id===item.id)));
 const added=afterItems.filter(item=>!beforeItems.some(old=>old.id===item.id));
 const editable=added.length>0&&added.every(item=>['FRAME','GROUP','VECTOR','ELLIPSE','RECTANGLE','BOOLEAN_OPERATION'].includes(String(item.type)));
 for(const [name,snapshot]of [['before',before],['after',after]]as const){const image=snapshot.previews.find(p=>p.nodeId===snapshot.target.nodeId);if(image)fs.writeFileSync(path.join(output,`${name}.png`),Buffer.from(image.dataUrl.split(',')[1],'base64'),{mode:0o600});}
 const report={scope:'live Figma host read/import/undo; existing validated SVG; no model request in this check',documentName,target:before.target,originalNodeCount:beforeItems.length,originalsPreserved,addedNodeCount:added.length,addedTypes:[...new Set(added.map(n=>n.type))],editable,svgSha256:crypto.createHash('sha256').update(svg).digest('hex')};
 if(!originalsPreserved||!editable)throw new Error('原有节点或可编辑性检查未通过');
 save('stage.json',{stage:'applied',output,...report});console.log(JSON.stringify({stage:'applied',output,...report}));
 const pauseDeadline=Date.now()+180000,control=path.join(output,'continue');
 while(!fs.existsSync(control)&&Date.now()<pauseDeadline)await delay(500);
 await office.request(sessionId,'undo',{anchorId,resultId,expectedRevision:1});undone=true;
 const restored=await office.request<FigmaSnapshot>(sessionId,'read',{anchorId});save('restored.json',restored);
 const restoredExactly=restored.version===before.version;
 save('report.json',{...report,restoredExactly});save('stage.json',{stage:'complete',output,restoredExactly});
 if(!restoredExactly)throw new Error('撤回后的页面版本与原稿不一致');
 console.log(JSON.stringify({stage:'complete',output,originalsPreserved,editable,restoredExactly}));
}catch(error){
 if(resultId&&!undone){try{await office.request(sessionId,'undo',{anchorId,resultId,expectedRevision:1});undone=true;}catch{/* Do not retry an uncertain write or delete a manually edited result. */}}
 save('error.json',{message:error instanceof Error?error.message:String(error),acknowledgedResult:Boolean(resultId),cleanedUp:undone});console.error('Figma 实机检查失败：',error);
}finally{if(anchorId)await office.request(sessionId,'release',{anchorId}).catch(()=>{});}
