import path from 'node:path';import fs from 'node:fs';import {fileURLToPath}from'node:url';import assert from'node:assert/strict';import {BlenderClient}from'../src/blender-client';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const c=new BlenderClient(root);const evidence:Record<string,unknown>={};
try{
 await c.connect();const target=await c.op('snapshot');evidence.before=target;
 const taskId='integration-'+Date.now();await c.op('preview',{taskId,target});
 evidence.preview=await c.op('status');assert.equal(evidence.preview&&((evidence.preview as any).previews).includes(taskId),true);
 let cancelled=await c.op('cancel',{taskId});assert(cancelled.cancelled);const afterCancel=await c.op('snapshot');assert.equal(afterCancel.signature,target.signature);
 evidence.cancelPreservesOriginal=true;
 const task='integration-commit-'+Date.now();let p=await c.op('preview',{taskId:task,target});
 let a=await c.op('adjust',{taskId:task,scale:1.1,height:.02});assert.equal(a.version,p.version+1);
 await assert.rejects(c.op('commit',{taskId:task,version:p.version}));evidence.staleVersionRejected=true;
 await c.op('commit',{taskId:task,version:a.version});const once=await c.op('status');await c.op('commit',{taskId:task,version:a.version});const twice=await c.op('status');assert.equal(once.sceneObjects,twice.sceneObjects);evidence.idempotentCommit=true;
 const undo=await c.op('undo',{taskId:task});assert.equal(undo.remainingObjects,target.objects);evidence.undoPreservesOriginal=true;
 // Snapshot selects the basket explicitly after root removal, via a trusted static command.
 await c.raw('execute_blender_code',{code:"import bpy\no=bpy.data.objects['Basket']\no.select_set(True)\nbpy.context.view_layer.objects.active=o",user_prompt:'验证取消和撤回不改变原场景。'});
 assert.equal((await c.op('snapshot')).signature,target.signature);
 evidence.result='passed';fs.writeFileSync(path.join(root,'.local/placement-check.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{await c.close();}
