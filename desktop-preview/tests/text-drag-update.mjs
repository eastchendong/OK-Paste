import assert from 'node:assert/strict';
import {test} from 'node:test';
import {safeToRestart,patches} from '../../scripts/update-text-drag-app.mjs';

test('the scoped update refuses active work, generated drafts, uncertain writes and pending Blender previews',()=>{
 for(const phase of ['idle','ready','error'])assert.equal(safeToRestart({phase,revision:0}),true);
 for(const status of [undefined,{},...['running','planning','preview','done'].map(phase=>({phase})),
  {phase:'ready',canUndo:true},{phase:'error',mutationUncertain:true},{phase:'error',previewText:'未交付的邮件'},
  {phase:'ready',pendingDrop:{eventId:'真实落点'}},{phase:'error',previewPath:'/preview'},
  {phase:'error',previewImage:'真实预览'},{phase:'ready',revision:1}])assert.equal(safeToRestart(status),false);
});
test('the update includes its native drag route and email target without shipping Blender transaction changes',()=>{
 const targets=patches.map(([,target])=>target);
 assert.ok(targets.includes('scripts/clipboard-serve.ts'));
 assert.ok(targets.includes('src/clipboard/server.ts'));
 assert.ok(targets.includes('src/desktop-agent.ts'));
 assert.ok(targets.includes('src/targets/input-live.ts'));
 assert.ok(targets.includes('ui/desktop-live.js'));
 assert.ok(targets.every(target=>!target.startsWith('blender/')&&!['src/scene-runner.ts','src/types.ts','src/agent-controller.ts'].includes(target)));
});
