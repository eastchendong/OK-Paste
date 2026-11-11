/** Real configured model + upstream stdio MCP + TCP + isolated batch Blender.
 * The fixture uses production upstream TCP handlers; batch look is camera render.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {BlenderClient} from '../src/blender-client';
import {AgentClient} from '../src/agent-client';
const root=process.cwd();
const folder=path.join(root,'.local',`isolated-mcp-${Date.now()}`);
fs.mkdirSync(folder,{recursive:true});
const reserve=net.createServer();await new Promise<void>(resolve=>reserve.listen(0,'127.0.0.1',resolve));
const port=(reserve.address() as net.AddressInfo).port;
await new Promise<void>(resolve=>reserve.close(()=>resolve()));
const out=fs.openSync(path.join(folder,'blender.log'),'w');
const processHandle=spawn('/Applications/Blender.app/Contents/MacOS/Blender',['--background','--factory-startup','--python','scripts/blender-mcp-background-fixture.py','--',root,folder,String(port)],{cwd:root,stdio:['ignore',out,out],env:{...process.env,DISABLE_TELEMETRY:'1',BLENDER_MCP_DISABLE_TELEMETRY:'1'}});
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
class IsolatedClient extends BlenderClient {
 async connect(){
  const transport=new StdioClientTransport({command:path.join(root,'.local/mcp-venv/bin/python'),args:['-c','from blender_mcp.server import main; main()','--host','127.0.0.1','--port',String(port)],cwd:root,env:{PATH:process.env.PATH??'/usr/bin:/bin',HOME:process.env.HOME??'',DISABLE_TELEMETRY:'1',BLENDER_MCP_DISABLE_TELEMETRY:'1'},stderr:'pipe'});
  transport.stderr?.pipe(fs.createWriteStream(path.join(folder,'mcp.log')));
  await this.client.connect(transport);this.toolDefinitions=(await this.client.listTools()).tools;this.tools=this.toolDefinitions.map(t=>t.name);this.connected=true;return this.tools;
 }
}
const client=new IsolatedClient(root),task='isolated-mcp-check-'+Date.now();
const marker=(r:any)=>{const value=r.content.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n');const markerIndex=value.lastIndexOf('CHECK_JSON:');if(markerIndex<0)throw new Error(value.slice(0,600));return JSON.parse(value.slice(markerIndex+11).trim());};
let success=false;
try {
 for(let i=0;i<200&&!fs.existsSync(path.join(folder,'ready'));i++){if(processHandle.exitCode!==null)throw new Error('Isolated Blender exited');await sleep(100);}
 assert(fs.existsSync(path.join(folder,'ready')),'Isolated Blender did not become ready');
 const tools=await client.connect();assert(tools.includes('look')&&tools.includes('execute_blender_code'));
 const before=marker(await client.raw('execute_blender_code',{code:"import json, bpy, agent_scene\nagent_scene.ensure_ids(bpy.context.scene)\nprint('CHECK_JSON:'+json.dumps({'protected':agent_scene.protected(bpy.context.scene),'objects':len(bpy.context.scene.objects)}))",user_prompt:'检查隔离测试场景'}));
 const context=await client.op('context');
 const source='';const sceneImage=await client.look();
 const conversation=[{role:'user',text:'请创建一个橙色路锥，底座底面中心明确位于地面 (0,0,0)，总高约 0.8，最高点 z≈0.8；对象原点可自行选择，包含黑色方形底座和白色横条，作为可编辑的 Blender 物体。没有匹配 GLB，直接程序化建模。保留现有地面、相机和灯光，不移动或删除已有物体。先生成独立预览。'}];
 const agent=new AgentClient(root);
 const plan=await agent.plan({source,sceneImage,context,conversation,assets:[]});
 assert(!plan.needsClarification,'Model requested clarification for isolated cone fixture');
 await client.agentOp('begin',{task});
 const execution=await agent.execute({taskId:task,plan,context:await client.op('context'),source,sceneImage,assets:[],conversation,client,onStep:step=>console.log('MODEL_STEP',step)});
 const preview=await client.agentOp<any>('status',{task});
 assert(preview.originalUnchanged);assert(preview.changes.added.length>0);
 const image=await client.look();fs.writeFileSync(path.join(folder,'preview.png'),Buffer.from(image.split(',')[1],'base64'));
 const feedback=marker(await client.raw('execute_blender_code',{code:`import json, result_geometry\nprint('CHECK_JSON:'+json.dumps(result_geometry.describe(${JSON.stringify(task)})))`,user_prompt:'检查隔离测试反馈，无视口应明确报告'}));
 assert.equal(feedback.available,false);assert(['no-3d-viewport','inconsistent-window-metrics'].includes(feedback.reason),'Headless geometry must fail closed with an accurate unavailable reason');
 await client.agentOp('commit',{task,version:preview.version});
 const committed=await client.agentOp<any>('status',{task});assert(committed.committed);
 await client.agentOp('undo',{task});
 const after=marker(await client.raw('execute_blender_code',{code:"import json, bpy, agent_scene\nprint('CHECK_JSON:'+json.dumps({'protected':agent_scene.protected(bpy.context.scene),'objects':len(bpy.context.scene.objects)}))",user_prompt:'确认隔离测试撤回恢复'}));
 assert.deepEqual(after,before);
 const result={date:new Date().toISOString().slice(0,10),transport:'production-upstream-stdio-mcp-and-tcp-handlers',fixture:'independent-background-Blender-on-random-port',model:'configured-model',assets:[],plan:{title:plan.title,needsClarification:plan.needsClarification},execution:{calls:execution.calls},preview:{changes:preview.changes,originalUnchanged:preview.originalUnchanged,realImageBytes:Buffer.from(image.split(',')[1],'base64').length},commitConfirmed:committed.committed,undoRestored:true,feedback,boundaries:{productionSceneWritten:false,nativeDragTested:false,physicalShortcutTested:false,visibleMaskTested:false,batchTransportAdapter:'upstream socket/queue handlers pumped on main thread; look uses real camera render because upstream rejects background startup'}};
 fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify(result,null,2));
 console.log('RESULT',JSON.stringify({...result,localEvidence:path.relative(root,folder)}));success=true;
} finally {
 await client.agentOp('cancel',{task}).catch(()=>{});await client.close().catch(()=>{});
 fs.writeFileSync(path.join(folder,'stop'),'');
 await Promise.race([new Promise<void>(resolve=>processHandle.once('exit',()=>resolve())),sleep(5000)]);
 if(processHandle.exitCode===null)processHandle.kill('SIGTERM');
 fs.closeSync(out);
 if(!success)console.error('FAILED_EVIDENCE',path.relative(root,folder));
}
