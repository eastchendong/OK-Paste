import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {SceneRunner} from '../src/scene-runner';
import {ClipboardStore} from '../src/clipboard/store';
import {BlenderLink} from '../src/destinations/blender-link';

const root=process.cwd();
const directory=fs.mkdtempSync(path.join(root,'.local','text-check-'));
const store=new ClipboardStore(directory);
const source=store.add({type:'text',source:{title:'场景调整笔记'},body:{text:'保留篮子和已有苹果。把桌面改成浅蓝色，在篮外桌面创建一个绿色小立方体，边长 0.12 米，不新增苹果。'}});
const link=new BlenderLink(root);
const runner=new SceneRunner(root,link,store);
try {
 await link.connect(); assert(link.connected);
 const before=await link.client.op('context'); assert(!before.temporaryPreview,'请先处理当前预览');
 // Explicit instruction starts this developer check without an unsolicited plan call.
 runner.phase='ready'; runner.itemId=source.id;
 assert(runner.run({itemId:source.id,actionIndex:0,instruction:'按照这条场景笔记修改，先给我预览。'}).ok);
 const deadline=Date.now()+300_000;
 while(runner.status().phase==='running' && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,500));
 const result=runner.status();
 assert.equal(result.phase,'preview',result.error || result.summary);
 assert(result.changes?.added.length); assert(result.changes?.modified.length);
 const record=JSON.parse(fs.readFileSync(path.join(root,'.local/agent-run.json'),'utf8'));
 assert.equal(record.originalUnchanged,true);
 await runner.control('cancel');
 const after=await link.client.op('context');
 assert.equal(after.sceneFingerprint,before.sceneFingerprint,'取消后必须恢复正式场景');
 const evidence={checkedAt:new Date().toISOString(),sourceType:'text',instruction:source.body.text,changes:result.changes,originalUnchanged:true,cancelRestored:true,result:result.result,toolCalls:record.toolCalls};
 fs.writeFileSync(path.join(root,'.local/scene-text-check.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence,null,2));
} finally {
 await runner.shutdown().catch(()=>{});
 await link.client.close();
 fs.rmSync(directory,{recursive:true,force:true});
}
