import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {BlenderClient} from '../src/blender-client';

const c = new BlenderClient(process.cwd());
const task = 'copy-identity-' + Date.now();
try {
  await c.connect();
  await c.raw('execute_blender_code', {code: `import bpy,importlib.util,agent_scene,json
assert all(t['committed'] for t in agent_scene.TRANSACTIONS.values()), 'Finish the active preview first'
history=agent_scene.TRANSACTIONS
spec=importlib.util.spec_from_file_location('agent_scene',${JSON.stringify(path.join(process.cwd(),'blender/agent_scene.py'))})
spec.loader.exec_module(agent_scene)
agent_scene.TRANSACTIONS=history
bpy.context.view_layer.update()
agent_scene.ensure_ids(bpy.context.scene)
agent_scene.COPY_CHECK_BEFORE=agent_scene.protected(bpy.context.scene)`, user_prompt:'在没有活跃预览时载入当前事务模块，保留原有撤回记录。'});
  const begin = await c.agentOp('begin', {task});
  assert(begin.originalUnchanged);
  const result = await c.agentOp('run_code', {task, code: `import bpy
scene=bpy.context.scene
source=next(o for o in scene.objects if o.type=='MESH')
copy=source.copy()
copy.data=source.data.copy()
copy.name='CopyIdentityCheck'
scene.collection.objects.link(copy)
copy.location.x+=0.2
print('copied',source.name,copy.name)`});
  assert.deepEqual(result.changes.modified, [], 'copy must never replace the original stable identity');
  assert.deepEqual(result.changes.added, ['CopyIdentityCheck']);
  assert((await c.agentOp('status', {task})).originalUnchanged);
  await c.agentOp('commit', {task, version:result.version});
  const undo = await c.agentOp('undo', {task});
  assert(undo.restored);
  // Read in another tool call after context and viewport evaluation, not only
  // the immediate digest returned from undo itself.
  await c.op('context');await c.look();
  const verified=await c.raw('execute_blender_code',{code:"import bpy,agent_scene\nbpy.context.view_layer.update()\nassert agent_scene.protected(bpy.context.scene)==agent_scene.COPY_CHECK_BEFORE, 'delayed undo fingerprint differs'\nprint('DELAYED_UNDO_EXACT')",user_prompt:'核验依赖图重新计算后的撤回指纹'});
  assert(JSON.stringify(verified).includes('DELAYED_UNDO_EXACT'));
  const evidence = {checkedAt:new Date().toISOString(),added:result.changes.added,modified:result.changes.modified,originalUnchanged:true,commit:true,undoRestored:undo.restored,delayedUndoExact:true};
  fs.writeFileSync('.local/copy-identity-check.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
} finally {
  await c.agentOp('cancel', {task}).catch(()=>{});
  await c.close();
}
