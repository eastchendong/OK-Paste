import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DesktopAgent} from '../src/desktop-agent';
import {ClipboardStore} from '../src/clipboard/store';
import type {SceneRunner} from '../src/scene-runner';

let generated='第一版';
vi.mock('../src/agent-client',()=>({AgentClient:class {
 async planTarget(){return {title:'写回复',summary:'写回复',actions:[],questions:[],needsClarification:false,suggestions:['写一段回复']};}
 async executeTarget(input:any){await input.invoke('prepare_text',{text:generated});return {summary:'草稿已生成',calls:[]};}
}}));
const tasks:string[]=[];
afterEach(()=>{for(const dir of tasks.splice(0))fs.rmSync(dir,{recursive:true,force:true});generated='第一版';});
function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-input-'));tasks.push(root);
 const store=new ClipboardStore(path.join(root,'clipboard'));const copy=vi.fn();
 const scene={phase:'ready',status:()=>({phase:'ready'}),ensurePlanned(){},async shutdown(){}} as unknown as SceneRunner;
 const agent=new DesktopAgent(root,scene,store,copy);
 const focus={appName:'任意编辑器',bundleId:'example.unknown.editor',selectedText:'原选区'};
 const id=crypto.randomUUID();
 return {agent,store,id,focus,copy,scene};
}
it('pins an arbitrary input, writes without a source, revises in place and restores the original selection',async()=>{
 const {agent,id,focus,copy}=setup();await agent.beginInputPaste({id,focus,manual:false});
 await agent.updateFocus({appName:'另一个软件',bundleId:'example.other'});
 expect(agent.status()).toMatchObject({targetKind:'input-live',destinationId:'focused',phase:'ready'});
 const request=()=>agent.exchangeInput(id);
 async function receive(text:string,from:number,to:number){
  await vi.waitFor(()=>expect(request().command).toBeTruthy());
  const command=request().command!;expect(command).toMatchObject({text,from,to});
  expect(request().command?.id).toBe(command.id);
  expect(agent.exchangeInput(crypto.randomUUID()).command).toBeUndefined();
  agent.exchangeInput(id,{id:command.id,ok:true});
 }
 expect(agent.run({destinationId:'focused',itemIds:[],actionIndex:0,instruction:'写一段话'}).ok).toBe(true);
 await receive('第一版',0,1);await (agent.files as any).chain;
 expect(agent.status()).toMatchObject({phase:'done',revision:1,canUndo:true});
 generated='短版';expect(agent.run({itemIds:[],actionIndex:0,instruction:'简短一点',continuation:true}).ok).toBe(true);
 await receive('短版',1,2);await (agent.files as any).chain;
 const undo=agent.control('undo');await receive('第一版',2,1);await undo;
 const restore=agent.control('undo');await receive('原选区',1,0);await restore;
 expect(copy).not.toHaveBeenCalled();expect(agent.exchangeInput(id).active).toBe(false);
 await agent.shutdown();
});
it('cancels only its own unfinished native drop and prevents replay without losing sources or a newer task',async()=>{
 const {agent,id,focus,store}=setup();const source=store.add({type:'text',body:{text:'拖放合成资料'}});
 const nativeDrop={id:crypto.randomUUID(),host:'input' as const,windowId:1,x:-200,y:40,positioned:false,capturedAt:Date.now()};
 await agent.beginInputPaste({id,focus:{...focus,nativeDrop},manual:true});await (agent.files as any).chain;
 await agent.cancelNativeDrop(crypto.randomUUID());expect(agent.exchangeInput(id).active).toBe(true);
 expect(await agent.cancelNativeDrop(nativeDrop.id)).toEqual({ok:true});expect(agent.exchangeInput(id).active).toBe(false);
 expect(store.list().map(item=>item.id)).toEqual([source.id]);
 expect(()=>agent.beginInputPaste({id,focus:{...focus,nativeDrop},manual:false})).toThrow('只能复制');
 await expect(agent.beginInputPaste({id,focus:{...focus,nativeDrop},manual:true})).rejects.toThrow('已处理');
 const next={...nativeDrop,id:crypto.randomUUID(),capturedAt:Date.now()};await agent.beginInputPaste({id,focus:{...focus,nativeDrop:next},manual:true});
 await agent.cancelNativeDrop(nativeDrop.id);expect(agent.exchangeInput(id).active).toBe(true);
 expect(agent.run({itemIds:[],actionIndex:0,instruction:'只用合成要求'}).ok).toBe(true);await (agent.files as any).chain;
 expect((await agent.cancelNativeDrop(next.id)).ok).toBe(false);expect(agent.status().phase).toBe('done');
 await agent.shutdown();
});
it('keeps a known good draft on an explicit rejection and freezes an unconfirmed delivery',async()=>{
 const {agent,id,focus}=setup();await agent.beginInputPaste({id,focus,manual:false});
 async function run(receipt:{ok:boolean;error?:string;mutationStarted?:boolean}){
  expect(agent.run({itemIds:[],actionIndex:0,instruction:'更新文字'}).ok).toBe(true);
  await vi.waitFor(()=>expect(agent.exchangeInput(id).command).toBeTruthy());
  const {command}=agent.exchangeInput(id);agent.exchangeInput(id,{id:command!.id,...receipt});await (agent.files as any).chain;
 }
 await run({ok:true});generated='新稿';await run({ok:false,error:'原草稿已手改',mutationStarted:false});
 expect(agent.status()).toMatchObject({phase:'done',revision:1,error:'原草稿已手改',canUndo:true});
 await run({ok:false,error:'无法回读',mutationStarted:true});
 expect(agent.status()).toMatchObject({mutationUncertain:true,canUndo:false});
 expect(agent.run({itemIds:[],actionIndex:0,instruction:'重试'}).ok).toBe(false);await agent.shutdown();
});
it('uses an explicitly labelled clipboard fallback for opaque inputs and never reports a native write',async()=>{
 const {agent,id,focus,copy}=setup();await agent.beginInputPaste({id,focus,manual:true});
 expect(agent.run({itemIds:[],actionIndex:0,instruction:'写回复'}).ok).toBe(true);await (agent.files as any).chain;
 expect(copy).toHaveBeenCalledWith('第一版');expect(agent.status()).toMatchObject({phase:'done',canUndo:false,inputDelivery:'clipboard'});
 expect(agent.exchangeInput(id).command).toBeUndefined();await agent.control('finish');await agent.shutdown();
});
it('delivers a generated long email to a keyboard-only chat as a complete clipboard result',async()=>{
 const {agent,id,focus,copy,store}=setup();const source=store.add({type:'text',body:{text:'合成邮件资料。'.repeat(1000)}});
 generated='你好：\n'+'以下是完整项目说明。\n'.repeat(400)+'邮件末尾🙂';
 await agent.beginInputPaste({id,focus:{...focus,role:'keyboard-input'},manual:false});
 expect(agent.run({itemIds:[source.id],actionIndex:0,instruction:'整理成可以发给同事的邮件'}).ok).toBe(true);await (agent.files as any).chain;
 expect(copy).toHaveBeenCalledExactlyOnceWith(generated);
 expect(agent.status()).toMatchObject({phase:'done',revision:1,canUndo:false,inputDelivery:'clipboard',previewText:generated,error:''});
 expect(agent.exchangeInput(id).command).toBeUndefined();await agent.shutdown();
});
it('keeps unrelated collected sources when a standalone input prompt is completed',async()=>{
 const {agent,id,focus,store}=setup();const unrelated=store.add({type:'text',body:{text:'留给另一个任务'}});
 await agent.beginInputPaste({id,focus,manual:true});
 expect(agent.run({itemIds:[],actionIndex:0,instruction:'只使用这条指令'}).ok).toBe(true);await (agent.files as any).chain;
 await agent.control('finish');expect(store.list().map(item=>item.id)).toEqual([unrelated.id]);await agent.shutdown();
});

it('does not bypass the disabled host route through generic input capture',async()=>{
 const {agent,id,copy}=setup();
 await expect(agent.beginInputPaste({id,manual:false,focus:{appName:'剪映',bundleId:'com.lemon.lvpro'}})).rejects.toThrow('暂未启用');
 expect(agent.exchangeInput(id).active).toBe(false);expect(copy).not.toHaveBeenCalled();
 await agent.shutdown();
});

it('releases an untouched chat capture for a physical package drag without archiving its sources',async()=>{
 const {agent,id,focus,copy,store,scene}=setup();const source=store.add({type:'text',body:{text:'下一目标所需资料'}});
 await agent.beginInputPaste({id,focus,manual:false});await (agent.files as any).chain;
 expect(await agent.preparePackDrag()).toEqual({ok:true});
 expect(agent.exchangeInput(id).active).toBe(false);expect(store.list().map(item=>item.id)).toEqual([source.id]);
 expect(scene.onDrop?.()).toBe(true);expect(copy).not.toHaveBeenCalled();await agent.shutdown();
});

it('never silently discards a generated draft, even if its clipboard write failed before revision one',async()=>{
 const {agent,id,focus,copy,store}=setup();store.add({type:'text',body:{text:'合成资料'}});
 copy.mockImplementation(()=>{throw new Error('系统复制失败');});generated='未能复制的完整邮件\n第二段';
 await agent.beginInputPaste({id,focus,manual:true});await (agent.files as any).chain;
 expect(agent.run({itemIds:[],actionIndex:0,instruction:'生成邮件'}).ok).toBe(true);await (agent.files as any).chain;
 expect(agent.status()).toMatchObject({phase:'error',revision:0,previewText:generated});
 expect(await agent.preparePackDrag()).toMatchObject({ok:false,error:expect.stringContaining('结束当前任务')});
 expect(agent.exchangeInput(id).active).toBe(true);expect(store.list()).toHaveLength(1);await agent.shutdown();
});

it('keeps running, completed and uncertain input writes owned by their original task during a drag attempt',async()=>{
 const {agent,id,focus,store}=setup();store.add({type:'text',body:{text:'合成资料'}});
 await agent.beginInputPaste({id,focus,manual:false});await (agent.files as any).chain;
 expect(agent.run({itemIds:[],actionIndex:0,instruction:'生成短稿'}).ok).toBe(true);
 expect((await agent.preparePackDrag()).ok).toBe(false);
 await vi.waitFor(()=>expect(agent.exchangeInput(id).command).toBeTruthy());
 const command=agent.exchangeInput(id).command!;
 agent.exchangeInput(id,{id:command.id,ok:false,error:'回读未确认',mutationStarted:true});await (agent.files as any).chain;
 expect((await agent.preparePackDrag()).ok).toBe(false);expect(agent.exchangeInput(id).active).toBe(true);
 expect(store.list()).toHaveLength(1);await agent.shutdown();
});

it('prevents a competing generation or capture while an old position is being released for drag',async()=>{
 const {agent,id,focus,store}=setup();store.add({type:'text',body:{text:'合成资料'}});
 await agent.beginInputPaste({id,focus,manual:false});await (agent.files as any).chain;
 const original=agent.files.control.bind(agent.files);let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 vi.spyOn(agent.files,'control').mockImplementation(async action=>{await gate;return original(action);});
 const preparing=agent.preparePackDrag();
 expect(agent.run({itemIds:[],actionIndex:0,instruction:'不得趁释放位置时写入'})).toMatchObject({ok:false});
 await expect(agent.beginInputPaste({id:crypto.randomUUID(),focus,manual:false})).rejects.toThrow('准备内容拖放');
 expect((await agent.preparePackDrag()).ok).toBe(false);
 release();expect(await preparing).toEqual({ok:true});await agent.shutdown();
});
