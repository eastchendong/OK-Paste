import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {execFileSync} from 'node:child_process';
import {ClipboardStore} from '../src/clipboard/store';
import {FileRunner} from '../src/file-runner';
import {WordLiveTarget} from '../src/targets/word-live';
import {PowerPointLiveTarget,type PowerPointSnapshot} from '../src/targets/powerpoint-live';
import type {WordSnapshot} from '../src/office-live/bridge';

// Explicit local acceptance harness, not a product endpoint. It replaces the
// normal service, requires synthetic fixture markers, and uses isolated sources.
const host=process.argv[2];
if(!['word','powerpoint'].includes(host))throw new Error('指定 word 或 powerpoint；不要与常规服务同时启动');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.local',`office-revisions-${host}-${Date.now()}`);fs.mkdirSync(output,{recursive:true,mode:0o700});
const save=(name:string,value:unknown)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2),{mode:0o600});
const stage=(name:string,detail:Record<string,unknown>={})=>{save('stage.json',{stage:name,...detail});console.log(JSON.stringify({stage:name,output,...detail}));};
const {office}=await import('./clipboard-serve');
const store=new ClipboardStore(path.join(output,'sources'));
let runner:FileRunner|undefined;
try{
 const documentPath=process.argv[3];
 if(host==='powerpoint'&&(!documentPath||!path.basename(path.dirname(documentPath)).startsWith('ppt-revision-check-')))throw new Error('PPT 仅接受独立 ppt-revision-check-* 目录中的合成稿');
 let sessionId='';const connectionDeadline=Date.now()+180000;
 stage('waiting-for-fixture');
 while(!sessionId&&Date.now()<connectionDeadline){try{sessionId=office.select({appName:host,bundleId:host==='word'?'com.microsoft.Word':'com.microsoft.Powerpoint',...(documentPath?{documentPath}:{})},host as 'word'|'powerpoint');}catch{await delay(500);}}
 if(!sessionId)throw new Error('独立测试稿加载项未连接');
 const captured=await office.request<WordSnapshot&PowerPointSnapshot>(sessionId,'capture');
 save('before.json',captured);stage('fixture-captured');
 const source=store.add({type:'text',source:{title:'合成活动资料'},body:{text:'11月15日14:00至16:00在图书馆举办校园阅读活动，招募12名学生志愿者，负责签到、引导和图书整理。'}});
 const ids=[source.id];
 let target:WordLiveTarget|PowerPointLiveTarget;
 if(host==='word'){
  if(!captured.body.startsWith('妥帖固定位置流程验收')||!captured.location.before.includes('二、活动安排')||!captured.location.after.trimStart().startsWith('三、后续事项'))throw new Error('请在指定合成稿第二节的空行放置光标');
  target=new WordLiveTarget(office,sessionId,'独立 Word 流程验收',captured,store);
 }else{
  target=new PowerPointLiveTarget(root,office,sessionId,'独立 PPT 修订验收',captured,store);
  const context=await target.read();
  if(!JSON.stringify(context).includes('妥帖 · PowerPoint 图片替换测试')||captured.slideIndex!==0)throw new Error('不是独立合成 PPT 第一页');
  for(const name of ['source-a','source-b']){
   const item=store.add({type:'image',source:{title:name},body:{dataUrl:'data:image/png;base64,'+fs.readFileSync(path.join(path.dirname(documentPath!),name+'.png')).toString('base64')}});ids.push(item.id);
  }
 }
 runner=new FileRunner(root,store);await runner.useTarget(target);
 const settle=async(allowRecommendationError=false)=>{const deadline=Date.now()+240000;while(['running','planning'].includes(runner!.phase)&&Date.now()<deadline)await delay(500);if(!['done','ready'].includes(runner!.phase)&&!(allowRecommendationError&&runner!.phase==='error'))throw new Error(runner!.status().error||'模型未完成');};
 const read=()=>office.request<WordSnapshot&PowerPointSnapshot>(sessionId,'read',{anchorId:captured.anchorId});
 runner.ensurePlanned();await settle(true);
 if(runner.phase==='error')stage('recommendation-unavailable-custom-request-next');
 const request=host==='word'?'请只插入一句活动时间、地点和人数说明，保留前后原文。':'将标题改为“校园阅读活动团队”，02号旧头像替换成 source-a，03号椭圆空位放入 source-b；保持01号原头像及其他所有对象不变。';
 if(!runner.run({itemIds:ids,actionIndex:0,instruction:request}).ok)throw new Error('第一版未开始');
 await settle();if(target.revision!==1)throw new Error('第一版没有写入');
 const first=await read();save('first.json',first);
 if(host==='word'){
  for(const marker of ['妥帖固定位置流程验收','一、背景','二、活动安排','三、后续事项','这段原文必须保留。'])if(first.body.split(marker).length!==2)throw new Error('生成重复了上下文原文');
  if(!/[\r\n]三、后续事项/.test(first.body))throw new Error('生成片段与后续原段落相连');
 }
 stage('first-written',{revision:target.revision});
 const adjustment=host==='word'?'把本次新插入的说明改得更简短，保留时间、地点和12人，不重复前后原文。':'把本次标题改为“阅读志愿者团队”，将刚替换的两张图片改为完整显示，保留相同来源图片和原版式；提供完整新版本。';
 runner.run({itemIds:ids,actionIndex:0,instruction:adjustment,continuation:true});await settle();
 if(Number(target.revision)!==2)throw new Error('第二版没有写入');
 const second=await read();save('second.json',second);stage('second-written',{revision:target.revision});
 await runner.control('undo');if(target.revision!==1||runner.phase!=='done')throw new Error('没有回到第一版完成态');
 const restoredFirst=await read();save('restored-first.json',restoredFirst);
 await runner.control('undo');await runner.control('cancel');
 const restored=await read();save('restored-original.json',restored);
 const firstRestored=host==='word'?restoredFirst.body===first.body:JSON.stringify(restoredFirst.shapes.map(({id,...shape})=>shape))===JSON.stringify(first.shapes.map(({id,...shape})=>shape));
 const originalRestored=host==='word'?restored.body===captured.body:JSON.stringify(restored.shapes.map(({id,...shape})=>shape))===JSON.stringify(captured.shapes.map(({id,...shape})=>shape));
 // Restored picture IDs can differ; visual equality is a separate inspection.
 const renderDifference=host==='powerpoint'?JSON.parse(execFileSync(path.join(root,'.local/office-venv/bin/python'),['-c','import sys,json,base64,io;from PIL import Image,ImageChops,ImageStat;a,b=json.load(sys.stdin);a=Image.open(io.BytesIO(base64.b64decode(a))).convert("RGB");b=Image.open(io.BytesIO(base64.b64decode(b))).convert("RGB");d=ImageChops.difference(a,b);print(json.dumps({"meanAbsoluteChannelDifference":sum(ImageStat.Stat(d).mean)/3,"sameSize":a.size==b.size}))'],{input:JSON.stringify([captured.slideImage,restored.slideImage]),encoding:'utf8'})):undefined;
 const report={host,firstRestored,originalRestored,revisions:2,physicalShortcut:false,...(renderDifference?{renderDifference}:{})};save('report.json',report);
 if(!firstRestored||!originalRestored)throw new Error('恢复后的正文或对象属性不一致，请检查测试稿');
 stage('complete',report);
}catch(error){stage('failed',{error:error instanceof Error?error.message:String(error)});}
finally{
 if(runner){
  await runner.control('cancel').catch(()=>{});
  while(runner.status().canUndo)await runner.control('undo');
  await runner.shutdown();
 }
}
// The service remains alive for inspection; restart clipboard-serve when done.
