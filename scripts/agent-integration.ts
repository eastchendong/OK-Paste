import path from'node:path';import fs from'node:fs';import{BlenderClient}from'../src/blender-client';import{AgentClient}from'../src/agent-client';
const root=path.resolve('.');const c=new BlenderClient(root);const agent=new AgentClient(root);const taskId='natural-language-'+Date.now();
try{await c.connect();await c.raw('execute_blender_code',{code:'import importlib,agent_scene\nimportlib.reload(agent_scene)',user_prompt:'验证可对话 Blender Agent 的隔离预览操作。'});
 const context=await c.op('context');const source='data:image/jpeg;base64,'+fs.readFileSync('assets/reference/apple.jpg').toString('base64');const sceneImage=await c.look();
 const assets=[{name:'苹果模型',kind:'apple',path:path.join(root,'assets/models/apple.glb')}];
 const conversation=[{role:'user',text:'先不要新增苹果。请把桌面变成浅蓝色，并在篮子外面的桌面上创建一个小绿色立方体，边长 0.12。保留篮子和已经有的苹果。'}];
 const plan=process.argv.includes('--reuse-plan')?JSON.parse(fs.readFileSync('.local/natural-language-plan.json','utf8')):await agent.plan({source,sceneImage,context,conversation,assets});console.log('PLAN',JSON.stringify(plan));fs.writeFileSync('.local/natural-language-plan.json',JSON.stringify(plan,null,2));
 if(plan.needsClarification)throw Error('模型需要澄清：'+plan.questions.join('；'));
 await c.agentOp('begin',{task:taskId});const result=await agent.execute({taskId,plan,context,source,sceneImage,assets,conversation,client:c,onStep:step=>console.log('STEP',step)});
 const status=await c.agentOp('status',{task:taskId});console.log('RESULT',JSON.stringify({result,status}));
 fs.writeFileSync('.local/natural-language-execution.json',JSON.stringify({plan,result,status},null,2));
 const preview=await c.look();fs.writeFileSync('.local/natural-language-preview.png',Buffer.from(preview.split(',')[1],'base64'));
 await c.agentOp('cancel',{task:taskId});console.log('CANCELLED: original preserved');
}finally{await c.agentOp('cancel',{task:taskId}).catch(()=>{});await c.close();}
