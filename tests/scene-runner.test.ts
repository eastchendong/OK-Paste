import {afterEach, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ClipboardStore} from '../src/clipboard/store';
import {SceneRunner} from '../src/scene-runner';
import type {BlenderLink} from '../src/destinations/blender-link';

const model = vi.hoisted(() => ({plan: vi.fn(), execute: vi.fn()}));
vi.mock('../src/agent-client', () => ({AgentClient: class {plan = model.plan; execute = model.execute;}}));
const roots: string[] = [];
const runners: SceneRunner[] = [];
afterEach(() => {runners.splice(0).forEach(r => r.dispose()); roots.splice(0).forEach(p => fs.rmSync(p, {recursive:true,force:true})); vi.clearAllMocks();});
const plan = {title:'调整已有物体', summary:'已有物体位于真实场景中', actions:['改颜色','改变大小'], suggestions:['只调整已有物体的颜色','只调整大小'], questions:[],needsClarification:false};
async function setup() {
 const root = fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-run-')); roots.push(root);
 const store = new ClipboardStore(path.join(root,'.local','clipboard'));
 const item = store.add({type:'image',body:{dataUrl:'data:image/png;base64,aGVsbG8='}});
 const agentOp = vi.fn(async (action:string) => action==='status' ? {version:1,changes:{added:['NewObject'],modified:[],removed:[]},originalUnchanged:true} : {ok:true});
 const client = {op:vi.fn(async()=>({sceneFingerprint:'f1',sceneSessionId:'s1'})),look:vi.fn(async()=> 'data:image/png;base64,aGVsbG8='),agentOp,raw:vi.fn(async(_name:string,_args:Record<string,unknown>)=>({content:[{type:'text',text:'OKPASTE_JSON:{"area":"VIEW_3D","worldPoint":[1,2,3]}'}]}))};
 model.plan.mockResolvedValue(plan); model.execute.mockResolvedValue({summary:'临时预览已修改',calls:2});
 const runner = new SceneRunner(root,{connected:true,client} as unknown as BlenderLink,store); runners.push(runner);
 runner.ensurePlanned(); await (runner as any).chain;
 return {runner,item,client};
}

describe('desktop scene transactions',()=>{
 it('executes only the chosen direction, waits for apply, then really undoes',async()=>{
  const {runner,item,client} = await setup();
  expect(runner.actions).toEqual(plan.suggestions);
  expect(runner.run({itemId:item.id,actionIndex:1}).ok).toBe(true);
  await (runner as any).chain;
  expect(model.execute.mock.calls[0][0].plan.actions).toEqual(['只调整大小']);
  expect(runner.phase).toBe('preview');
  expect(client.agentOp.mock.calls.some(c=>c[0]==='commit')).toBe(false);
  await runner.control('commit'); expect(runner.phase).toBe('done');
  expect(runner.status().canUndo).toBe(true);
  await runner.control('undo');
  expect(client.agentOp.mock.calls.some(c=>c[0]==='undo')).toBe(true);
 });
 it('passes freeform compound instructions and leaves the original alone on cancel',async()=>{
  const {runner,client} = await setup();
  runner.run({actionIndex:3,instruction:'保留已有物体，把桌面改成浅蓝色，再添加一个绿色立方体'});
  await (runner as any).chain;
  expect(model.plan.mock.calls[1][0].conversation[0].text).toContain('绿色立方体');
  expect(runner.phase).toBe('preview');
  await runner.control('cancel');
  expect(client.agentOp.mock.calls.some(c=>c[0]==='cancel')).toBe(true);
  expect(client.agentOp.mock.calls.some(c=>c[0]==='commit')).toBe(false);
 });
 it('keeps model errors visible until explicit retry',async()=>{
  const {runner,client} = await setup();
  model.execute.mockRejectedValueOnce(new Error('Agent Plan HTTP 400: diagnostic'));
  runner.run({actionIndex:0}); await (runner as any).chain;
  expect(runner.phase).toBe('error'); expect(runner.error).toContain('400');
  runner.ensurePlanned(); expect(runner.phase).toBe('error');
  expect(client.agentOp.mock.calls.some(c=>c[0]==='cancel')).toBe(true);
 });
 it('asks for clarification without opening a transaction',async()=>{
  const {runner,client} = await setup();
  model.plan.mockResolvedValueOnce({...plan,needsClarification:true,questions:['放在哪里？'],suggestions:[]});
  runner.run({actionIndex:0,instruction:'再放一个'}); await (runner as any).chain;
  expect(runner.phase).toBe('ready'); expect(runner.status().questions).toEqual(['放在哪里？']);
  expect(client.agentOp).not.toHaveBeenCalled(); expect(model.execute).not.toHaveBeenCalled();
 });
});

describe('source and conversation continuity', () => {
 it('commits the latest revision after another preview adjustment using the same transaction',async()=>{
  const {runner,item,client}=await setup();
  let version=0;
  client.agentOp.mockImplementation(async(action:string)=>action==='status'
   ? {version:++version,changes:{added:['NewObject'],modified:[],removed:[]},originalUnchanged:true}
   : {ok:true});
  runner.run({itemId:item.id,actionIndex:0});await (runner as any).chain;
  runner.run({itemId:item.id,actionIndex:0,instruction:'调整相机、背景和倒角，保留第一轮模型'});await (runner as any).chain;
  const task=model.execute.mock.calls[0][0].taskId;
  expect(model.execute.mock.calls[1][0].taskId).toBe(task);
  expect(client.agentOp.mock.calls.filter(call=>call[0]==='begin')).toHaveLength(1);
  await runner.control('commit');
  expect(client.agentOp).toHaveBeenCalledWith('commit',{task,version:2});
  expect(runner.phase).toBe('done');
 });
 it('keeps scene-only adjustments available for apply instead of discarding them as no change',async()=>{
  const {runner,client}=await setup();
  client.agentOp.mockImplementation(async(action:string)=>action==='status'
   ? {version:2,changes:{added:[],modified:[],removed:[],scene:['环境与曝光']},originalUnchanged:true}
   : {ok:true});
  runner.run({actionIndex:0,instruction:'只调整背景和曝光'});await (runner as any).chain;
  expect(runner.phase).toBe('preview');
  expect(client.agentOp.mock.calls.some(call=>call[0]==='cancel')).toBe(false);
  expect(await runner.control('commit')).toEqual({ok:true});
 });
 it('plans from saved text without manufacturing a reference image', async () => {
  const {runner,client} = await setup();
  const store=(runner as any).store as ClipboardStore;
  const item=store.add({type:'text',source:{title:'场景笔记'},body:{text:'请把桌面调整成浅蓝色，保留已有物体'}});
  runner.ensurePlanned(); await (runner as any).chain;
  const request=model.plan.mock.calls.at(-1)![0];
  expect(request.source).toBe('');
  expect(request.context.sources[0].body.text).toContain('浅蓝色');
  runner.run({itemId:item.id,actionIndex:0,instruction:'按这段笔记调整'});
  await (runner as any).chain;
  expect(model.execute.mock.calls.at(-1)![0].source).toBe('');
  expect(runner.phase).toBe('preview');
  expect(client.agentOp.mock.calls.some(c=>c[0]==='commit')).toBe(false);
 });
 it('applies a supplement to the same preview and retains prior conversation', async () => {
  const {runner,client} = await setup();
  let release!: () => void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  model.execute.mockImplementationOnce(async()=>{await gate;return {summary:'第一轮完成',calls:1};});
  runner.run({actionIndex:0});
  await vi.waitFor(()=>expect(model.execute).toHaveBeenCalledTimes(1));
  expect(runner.supplement('同时把新物体改成绿色').ok).toBe(true);
  release(); await (runner as any).chain;
  expect(model.execute).toHaveBeenCalledTimes(2);
  expect(model.execute.mock.calls[1][0].conversation.map((m:{text:string})=>m.text)).toContain('第一轮完成');
  expect(model.execute.mock.calls[1][0].conversation.at(-1).text).toBe('同时把新物体改成绿色');
  expect(client.agentOp.mock.calls.filter(c=>c[0]==='begin')).toHaveLength(1);
  expect(runner.phase).toBe('preview');
 });
 it('opens a drop discussion even when the ray misses, and never executes on drop alone', async () => {
  const {runner} = await setup();
  const root=(runner as any).root as string;
  fs.writeFileSync(path.join(root,'.local','drop-event.json'),JSON.stringify({eventId:'miss',context:{cursor:{area:'VIEW_3D',hit:false,locationRelation:'unresolved'}}}));
  (runner as any).ingestDrop(); await (runner as any).chain;
  expect(runner.status().pendingDrop?.eventId).toBe('miss');
  expect(runner.status().pendingDrop?.placeable).toBe(false);
  expect(model.execute).not.toHaveBeenCalled();
 });
 it('confirms the interpreted drop plan rather than the first alternative recommendation',async()=>{
  const {runner,item}=await setup();
  const dropPlan={...plan,title:'在落点新增物体',actions:['保留原物体','在真实落点新增'],suggestions:['修改已有物体颜色']};
  model.plan.mockResolvedValueOnce(dropPlan);
  const root=(runner as any).root as string;
  fs.writeFileSync(path.join(root,'.local/drop-event.json'),JSON.stringify({eventId:'actual-drop',context:{cursor:{area:'VIEW_3D',hit:true,worldPoint:[1,2,3]}}}));
  (runner as any).ingestDrop();await (runner as any).chain;
  expect(model.execute).not.toHaveBeenCalled();
  expect(runner.run({itemId:item.id,actionIndex:0,dropEventId:'actual-drop'}).ok).toBe(true);
  await (runner as any).chain;
  expect(model.execute.mock.calls[0][0].plan).toEqual(dropPlan);
  expect(runner.phase).toBe('preview');
 });
 it('refreshes Blender recommendations using every active package item',async()=>{
  const {runner,item}=await setup();
  const store=(runner as any).store as ClipboardStore;
  const notes=store.add({type:'text',body:{text:'只修改材质，保留所有已有对象'}});
  runner.ensurePlanned();await (runner as any).chain;
  const context=model.plan.mock.calls.at(-1)![0].context;
  expect(context.sources.map((x:any)=>x.id).sort()).toEqual([item.id,notes.id].sort());
  store.archive([item.id,notes.id]);runner.ensurePlanned();await (runner as any).chain;
  expect(runner.status().actions).toEqual([]);expect(runner.status().phase).toBe('idle');
 });

});

describe('Blender shortcut target and result feedback',()=>{
 it('freezes the actual viewport centre for planning, retries and confirmation without executing on capture',async()=>{
  const {runner,item,client}=await setup();
  const focus={appName:'Blender',bundleId:'org.blenderfoundation.blender'};
  await runner.beginPaste(focus);await (runner as any).chain;
  const drop=runner.status().pendingDrop!;
  expect(drop).toMatchObject({summary:'三维视口中心',placeable:true,cursorOrigin:'viewport-center'});
  expect(model.plan.mock.calls.at(-1)![0].context).toMatchObject({cursorOrigin:'viewport-center',cursor:{worldPoint:[1,2,3]}});
  expect(model.plan.mock.calls.at(-1)![0].conversation[0].text).toContain('不是鼠标落点');
  expect(model.execute).not.toHaveBeenCalled();expect(client.agentOp).not.toHaveBeenCalled();
  const reads=client.raw.mock.calls.length;
  runner.updateFocusContext({...focus,windowTitle:'刷新聚焦'});runner.ensurePlanned();await (runner as any).chain;
  expect(client.raw.mock.calls).toHaveLength(reads);
  await runner.control('retry');await (runner as any).chain;
  expect(runner.status().pendingDrop?.eventId).toBe(drop.eventId);
  expect(model.plan.mock.calls.at(-1)![0].context.cursor.worldPoint).toEqual([1,2,3]);
  runner.run({itemId:item.id,actionIndex:0,dropEventId:drop.eventId});await (runner as any).chain;
  expect(model.execute.mock.calls.at(-1)![0].context).toMatchObject({cursorOrigin:'viewport-center',cursor:{worldPoint:[1,2,3]}});
  expect(runner.phase).toBe('preview');
 });
 it('rejects unavailable viewport capture and a second capture during preview',async()=>{
  const {runner,client}=await setup();
  client.raw.mockResolvedValueOnce({content:[{type:'text',text:'OKPASTE_JSON:{"error":"no-view"}'}]});
  await expect(runner.beginPaste({appName:'Blender',bundleId:'org.blenderfoundation.blender'})).rejects.toThrow('三维视口');
  expect(runner.status().pendingDrop).toBeNull();
  expect(runner.run({actionIndex:0}).ok).toBe(false);
  runner.ensurePlanned();await (runner as any).chain;
  runner.run({actionIndex:0});await (runner as any).chain;
  await expect(runner.beginPaste({appName:'Blender',bundleId:'org.blenderfoundation.blender'})).rejects.toThrow('当前任务');
 });
 it('reads result geometry after the final screenshot and preserves a successful preview and commit when feedback fails',async()=>{
  const {runner,client}=await setup();
  client.raw.mockImplementation(async(_name:any,args:any)=>{
   if(String(args.code).includes('result_geometry.describe'))throw new Error('display unavailable');
   return {content:[{type:'text',text:'OKPASTE_JSON:{"worldPoint":[1,2,3]}'}]};
  });
  runner.run({actionIndex:0});await (runner as any).chain;
  expect(runner.phase).toBe('preview');expect(runner.status().previewAvailable).toBe(true);
  expect(runner.status().resultFeedback).toMatchObject({phase:'preview',available:false});
  const feedbackIndex=client.raw.mock.calls.findIndex((call:any)=>String(call[1].code).includes('result_geometry.describe'));
  expect(client.look.mock.invocationCallOrder.at(-1)!).toBeLessThan(client.raw.mock.invocationCallOrder[feedbackIndex]);
  expect(await runner.control('commit')).toEqual({ok:true});
  expect(runner.status()).toMatchObject({phase:'done',canUndo:true,resultFeedback:{phase:'done',available:false}});
  expect(client.agentOp.mock.calls.some(c=>c[0]==='cancel')).toBe(false);
 });
});

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
describe('shortcut capture concurrency',()=>{
 it('invalidates old candidates immediately and blocks execution, auto-planning, drops and controls while connecting',async()=>{
  const {runner,item,client}=await setup();
  const link=(runner as any).blender, gate=deferred<void>();
  link.connected=false;link.connect=vi.fn(async()=>{await gate.promise;link.connected=true;});
  const outcome=runner.beginPaste({appName:'Blender',bundleId:'org.blenderfoundation.blender'}).catch(error=>error);
  await vi.waitFor(()=>expect(link.connect).toHaveBeenCalledOnce());
  expect(runner.status()).toMatchObject({phase:'planning',actions:[],needsClarification:false});
  expect(runner.run({itemId:item.id,actionIndex:0}).ok).toBe(false);
  const plans=model.plan.mock.calls.length;runner.ensurePlanned();
  fs.writeFileSync(path.join((runner as any).root,'.local/drop-event.json'),JSON.stringify({eventId:'during-capture',context:{cursor:{worldPoint:[9,9,9]}}}));
  (runner as any).ingestDrop();
  for(const action of ['retry','finish','undo','commit'] as const)expect((await runner.control(action)).ok).toBe(false);
  expect(model.plan).toHaveBeenCalledTimes(plans);expect(model.execute).not.toHaveBeenCalled();expect(runner.status().pendingDrop).toBeNull();
  await runner.control('cancel');gate.resolve();
  expect(await outcome).toBeInstanceOf(Error);
  expect(client.raw).toHaveBeenCalledTimes(1);
  expect(runner.status().pendingDrop).toBeNull();
 });
 it('ignores an old cursor response after cancellation and a newer capture has completed',async()=>{
  const {runner,client}=await setup();
  const old=deferred<{content:{type:string;text:string}[]}>();
  client.raw.mockImplementationOnce(async()=>old.promise);
  const first=runner.beginPaste({appName:'Blender',bundleId:'org.blenderfoundation.blender'}).catch(error=>error);
  await vi.waitFor(()=>expect(client.raw.mock.calls.length).toBe(2));
  await runner.control('cancel');
  client.raw.mockResolvedValueOnce({content:[{type:'text',text:'OKPASTE_JSON:{"area":"VIEW_3D","worldPoint":[7,8,9]}'}]});
  await runner.beginPaste({appName:'Blender',bundleId:'org.blenderfoundation.blender'});await (runner as any).chain;
  const current=runner.status().pendingDrop!.eventId;
  old.resolve({content:[{type:'text',text:'OKPASTE_JSON:{"area":"VIEW_3D","worldPoint":[0,0,0]}'}]});
  expect(await first).toBeInstanceOf(Error);
  expect(runner.status()).toMatchObject({phase:'ready',pendingDrop:{eventId:current}});
  expect(model.plan.mock.calls.at(-1)![0].context.cursor.worldPoint).toEqual([7,8,9]);
 });
 it('exposes clarification explicitly even when a model also supplies candidate text',async()=>{
  const {runner}=await setup();
  model.plan.mockResolvedValueOnce({...plan,needsClarification:true,questions:['选哪个位置？'],suggestions:['有歧义的候选']});
  await runner.beginPaste({appName:'Blender',bundleId:'org.blenderfoundation.blender'});await (runner as any).chain;
  expect(runner.status()).toMatchObject({needsClarification:true,questions:['选哪个位置？']});
 });
});

it('sends an edited recommendation at the frozen drop without a second planning request',async()=>{
 const {runner,item,client}=await setup();
 await runner.beginPaste({appName:'Blender',bundleId:'org.blenderfoundation.blender'});await (runner as any).chain;
 const token=runner.status().pendingDrop!.eventId,plans=model.plan.mock.calls.length;
 expect(runner.run({itemId:item.id,actionIndex:0,instruction:'在此处生成两个蓝色物体',dropEventId:token}).ok).toBe(true);
 await (runner as any).chain;
 expect(model.plan).toHaveBeenCalledTimes(plans);
 expect(model.execute.mock.calls.at(-1)![0]).toMatchObject({plan:{title:'在此处生成两个蓝色物体'},context:{cursor:{worldPoint:[1,2,3]}}});
 expect(client.agentOp.mock.calls.some(c=>c[0]==='commit')).toBe(false);
});
it('uses the latest verified look image instead of capturing the preview again',async()=>{
 const {runner,client}=await setup();
 model.execute.mockResolvedValueOnce({summary:'已验证预览',calls:2,previewImage:'data:image/png;base64,dmVyaWZpZWQ='});
 const reads=client.look.mock.calls.length;
 runner.run({actionIndex:0});await (runner as any).chain;
 expect(client.look.mock.calls.length-reads).toBe(1);
 expect(runner.status().previewAvailable).toBe(true);
});

it('accepts an explicit prompt while a captured-target recommendation is loading and discards its late reply',async()=>{
 const {runner,item}=await setup();
 const gate=deferred<typeof plan>();model.plan.mockImplementationOnce(()=>gate.promise);
 await runner.beginPaste({appName:'Blender',bundleId:'org.blenderfoundation.blender'});
 await vi.waitFor(()=>expect(model.plan).toHaveBeenCalledTimes(2));
 const eventId=runner.status().pendingDrop!.eventId;
 expect(runner.run({itemId:item.id,actionIndex:0,instruction:'在这个位置生成绿色立方体',dropEventId:eventId}).ok).toBe(true);
 expect(model.plan.mock.calls[1][1].aborted).toBe(true);
 gate.resolve({...plan,title:'迟到的错误方向'});await (runner as any).chain;
 expect(model.plan).toHaveBeenCalledTimes(2);
 expect(model.execute.mock.calls[0][0].plan.title).toBe('在这个位置生成绿色立方体');
 expect(runner.phase).toBe('preview');
});
