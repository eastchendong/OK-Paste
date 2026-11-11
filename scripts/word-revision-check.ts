import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {execFileSync} from 'node:child_process';
import {ClipboardStore} from '../src/clipboard/store';
import {WordLiveTarget} from '../src/targets/word-live';
import {FileRunner} from '../src/file-runner';
import type {WordSnapshot} from '../src/office-live/bridge';

// Explicit developer check: replaces clipboard-serve, never runs alongside it.
// Uses an isolated store and refuses any document without the fixture title.
const documentPath=process.argv[2];
if(!documentPath||!path.basename(documentPath).startsWith('Word-v2-验收-'))throw new Error('请指定独立 Word-v2-验收-*.docx 测试稿');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.local',`word-v2-check-${Date.now()}`);fs.mkdirSync(output,{recursive:true,mode:0o700});
const save=(name:string,value:unknown)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2),{mode:0o600});
const stage=(name:string,detail:Record<string,unknown>={})=>{save('stage.json',{stage:name,...detail});console.log(JSON.stringify({stage:name,output,...detail}));};
function content(xml:string){
 return execFileSync('python3',['-c',`
import sys,json,xml.etree.ElementTree as E
root=E.fromstring(sys.stdin.read())
body=root.find('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}body')
assert body is not None, 'Word 未返回正文 OOXML'
def canonical(n):
 name=n.tag.split('}')[-1]
 if name in ('proofErr','proofState'): return None
 attrs=sorted((k,v) for k,v in n.attrib.items() if not k.split('}')[-1].startswith('rsid') and k.split('}')[-1] not in ('paraId','textId') and not ('wordprocessingDrawing' in k and k.split('}')[-1] in ('anchorId','editId')))
 return [n.tag,attrs,n.text if name in ('t','instrText','delText') else '',[x for c in n if (x:=canonical(c)) is not None]]
print(json.dumps(canonical(body),ensure_ascii=False))
 `],{input:xml,encoding:'utf8',maxBuffer:8*1024*1024});
}
const {office}=await import('./clipboard-serve');
let target:WordLiveTarget|undefined,runner:FileRunner|undefined;
try{
 let sessionId='';const deadline=Date.now()+60000;
 while(!sessionId&&Date.now()<deadline){try{sessionId=office.select({appName:'Word',bundleId:'com.microsoft.Word',documentPath},'word');}catch{await delay(500);}}
 if(!sessionId)throw new Error('测试文稿的加载项未连接');
 const before=await office.request<WordSnapshot>(sessionId,'capture');
 if(!before.body.startsWith('妥帖 Word 修订测试（合成文稿）'))throw new Error('不是合成测试稿，未写入');
 if(!before.location.after.startsWith('三、后续事项'))throw new Error('请将插入光标放到“三、后续事项”前');
 save('before.json',before);
 const store=new ClipboardStore(path.join(output,'clipboard'));
 const image=store.add({type:'image',source:{title:'合成验收插图：仓库示例苹果'},body:{dataUrl:`data:image/jpeg;base64,${fs.readFileSync(path.join(root,'assets/reference/apple.jpg')).toString('base64')}`}});
 const text=store.add({type:'text',source:{title:'合成活动资料'},body:{text:'校园阅读活动：11月15日14:00—16:00，图书馆一层。招募12名志愿者，负责签到、书籍整理、活动记录。请使用苹果图片作为测试插图。'}});
 const ids=[text.id,image.id];
 target=new WordLiveTarget(office,sessionId,path.basename(documentPath),before,store);
 const read=()=>office.request<WordSnapshot>(sessionId,'read',{anchorId:before.anchorId});
 const patch=(version:number)=>({blocks:[{type:'paragraph',runs:[{text:`活动安排 · 第${version}版`,bold:true,fontSizePt:version===1?16:18,color:'163868'}]},{type:'paragraph',runs:[{text:version===1?'十一月十五日，图书馆一层，招募十二名志愿者。':'11月15日，在图书馆招募12名志愿者。'}]},{type:'image',imageId:image.id,widthPt:version===1?96:120,alt:'苹果测试插图'}]});
 await target.read();await target.begin(ids);await target.invoke('prepare_word_patch',patch(1));await target.commit();
 const first=await read();save('first.json',first);
 if(!first.body.includes('活动安排 · 第1版')||!first.bodyOoxml.includes('drawing'))throw new Error('图文未出现在真实 Word 正文');
 await target.read();await target.begin(ids);await target.invoke('prepare_word_patch',patch(2));await target.commit();
 const second=await read();save('second.json',second);stage('rich-v2-applied',{revision:target.revision});
 // Allows a screenshot without holding a tool call open; touch this test's continue file.
 const pauseDeadline=Date.now()+120000;while(!process.argv.includes('--no-pause')&&!fs.existsSync(path.join(output,'continue'))&&Date.now()<pauseDeadline)await delay(500);
 await target.undo();const restoredFirst=await read();save('restored-first.json',restoredFirst);
 const firstRestored=content(restoredFirst.bodyOoxml)===content(first.bodyOoxml);
 await target.undo();const restoredOriginal=await read();save('restored-original.json',restoredOriginal);
 const originalRestored=content(restoredOriginal.bodyOoxml)===content(before.bodyOoxml);
 stage('host-check-complete',{firstRestored,originalRestored});
 if(!firstRestored||!originalRestored)throw new Error('撤销后正文内容或格式与之前不一致');

 if(process.argv.includes('--host-only')){
  save('report.json',{firstRestored,originalRestored,scope:'live Word rich-range insertion/replacement/undo; no model call'});stage('complete',{firstRestored,originalRestored});
 }else{
 runner=new FileRunner(root,store);await runner.useTarget(target);
 const settle=async()=>{const until=Date.now()+240000;while(['running','planning'].includes(runner!.phase)&&Date.now()<until)await delay(500);if(runner!.phase!=='done'&&runner!.phase!=='ready')throw new Error(runner!.status().error||'模型任务未结束');};
 runner.ensurePlanned();await settle();
 runner.run({itemIds:ids,actionIndex:0,instruction:'在活动安排部分插入小标题“志愿者招募”，设为16磅蓝色加粗；写一段活动说明，并插入内容包中的苹果测试图片，宽96磅。保留其他原文。'});await settle();
 if(runner.status().revision!==1)throw new Error('模型第一版未写入');
 save('model-first.json',await read());
 runner.run({itemIds:ids,actionIndex:0,continuation:true,instruction:'把刚才的说明缩短为一句话，将小标题改为18磅，保留蓝色加粗和苹果图片。'});await settle();
 if(runner.status().revision!==2)throw new Error('模型第二版未写入');
 save('model-second.json',await read());stage('model-v2-applied',{revision:runner.status().revision});
 const modelPause=Date.now()+120000;while(!fs.existsSync(path.join(output,'model-continue'))&&Date.now()<modelPause)await delay(500);
 await runner.control('undo');if(runner.status().phase!=='done'||runner.status().revision!==1)throw new Error('未回到第一版完成态');
 await runner.control('undo');await runner.control('cancel');
 const modelRestored=content((await read()).bodyOoxml)===content(before.bodyOoxml);
 save('report.json',{firstRestored,originalRestored,modelRestored,scope:'live Word Office.js rich insertion, replacement, readback, stepwise undo, real model with isolated synthetic sources; no physical shortcut claim'});
 if(!modelRestored)throw new Error('模型任务撤销后原文不一致');
 stage('complete',{firstRestored,originalRestored,modelRestored});
 }
}catch(error){save('error.json',{error:error instanceof Error?error.message:String(error)});stage('failed',{error:error instanceof Error?error.message:String(error)});}
finally{if(runner)await runner.shutdown();else await target?.dispose();}
// clipboard-serve remains the normal service until the developer restarts it.
