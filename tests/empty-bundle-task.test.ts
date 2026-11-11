import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {DesktopAgent} from '../src/desktop-agent';import {ClipboardStore} from '../src/clipboard/store';
import type {SceneRunner} from '../src/scene-runner';import type {WordBridge} from '../src/office-live/bridge';
const model=vi.hoisted(()=>({plan:vi.fn()}));
vi.mock('../src/agent-client',()=>({AgentClient:class {planTarget(...args:any[]){return model.plan(...args);}}}));
let root='';afterEach(()=>{if(root)fs.rmSync(root,{recursive:true,force:true});});
it.each(['ready','planning'])('clearing a %s task releases its position and allows another task',async(phase)=>{
 root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-empty-'));
 const store=new ClipboardStore(path.join(root,'clipboard'));const source=store.add({type:'text',body:{text:'资料'}});
 const plan={title:'整理资料',summary:'整理',actions:['整理'],suggestions:['整理资料'],questions:[],needsClarification:false};
 let resolvePlan!:(value:any)=>void;
 model.plan.mockImplementation(()=>phase==='planning'?new Promise(resolve=>{resolvePlan=resolve;}):Promise.resolve(plan));
 const scenes={phase:'idle',status:()=>({phase:'idle'}),ensurePlanned(){},async shutdown(){}} as unknown as SceneRunner;
 const agent=new DesktopAgent(root,scenes,store,vi.fn());
 const snapshot={protocolVersion:2,anchorId:'a',body:'正文',bodyOoxml:'original',paragraphs:[],location:{paragraphIndex:0,before:'',after:'正文',section:'第二节'}};
 const request=vi.fn(async(_id:string,method:string)=>['read','capture'].includes(method)?snapshot:{ok:true});
 const bridge={select:()=> 'session',request} as unknown as WordBridge;
 const focus={appName:'Word',bundleId:'com.microsoft.Word'};
 try{
  await agent.beginWordPaste(focus,bridge);
  if(phase==='ready')await (agent.files as any).chain;else await vi.waitFor(()=>expect(resolvePlan).toBeTypeOf('function'));
  store.archive([source.id]);const ending=agent.ensurePlanned();
  // A new reference arriving while release is pending belongs to the next task.
  const next=store.add({type:'text',body:{text:'新资料'}});
  if(phase==='planning')resolvePlan(plan);
  await ending;
  expect(agent.status().anchor).toBeUndefined();
  expect(request.mock.calls.filter(c=>c[1]==='release')).toHaveLength(1);
  expect(store.list().map(item=>item.id)).toEqual([next.id]);
  model.plan.mockResolvedValue(plan);
  await agent.beginWordPaste(focus,bridge);await (agent.files as any).chain;
  expect(agent.status()).toMatchObject({phase:'ready',targetKind:'word-live'});
 }finally{await agent.shutdown();}
});
