import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {FileRunner} from '../src/file-runner';
import {ClipboardStore} from '../src/clipboard/store';
const model=vi.hoisted(()=>({planTarget:vi.fn(),executeTarget:vi.fn()}));
vi.mock('../src/agent-client',()=>({AgentClient:class{planTarget=model.planTarget;executeTarget=model.executeTarget;}}));
let root='';afterEach(()=>{if(root)fs.rmSync(root,{recursive:true,force:true});vi.resetAllMocks();});
async function setup(){
 root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-lifecycle-'));
 const store=new ClipboardStore(path.join(root,'clipboard')),source=store.add({type:'text',body:{text:'参考资料'}});
 const target={kind:'word-live',name:'隔离测试',file:'',applyImmediately:true,previewPath:'',previewText:'',previewChanged:false,canUndo:false,originalUnchanged:true,
  fingerprint:()=> 'v1',read:async()=>({kind:'word-live',fingerprint:'v1'}),tools:()=>[],
  begin:vi.fn(async()=>{}),invoke:vi.fn(),cancel:vi.fn(),commit:vi.fn(async()=>{target.canUndo=true;}),undo:vi.fn()};
 model.planTarget.mockResolvedValue({title:'插入摘要',summary:'插入摘要',actions:['插入'],suggestions:['插入摘要','补充案例'],questions:[],needsClarification:false});
 model.executeTarget.mockImplementation(async()=>{target.previewChanged=true;return {summary:'已准备',calls:1};});
 const applied=vi.fn(),runner=new FileRunner(root,store,applied);await runner.useTarget(target);runner.ensurePlanned();
 const settled=()=>(runner as any).chain as Promise<void>;await settled();
 const run=()=>runner.run({itemIds:[source.id],actionIndex:0});
 return {runner,target,run,settled,applied};
}
it('asks for one recommendation and accepts a legacy model response with extra directions',async()=>{
 const {runner}=await setup();
 expect(model.planTarget.mock.calls[0][0].recommendationCount).toBe(1);
 expect(runner.status().actions).toEqual(['插入摘要']);await runner.shutdown();
});
it('stopping a delayed model prevents target commit even when the provider ignores abort',async()=>{
 const {runner,target,run,settled,applied}=await setup();
 let release!:()=>void;model.executeTarget.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>{target.previewChanged=true;resolve({summary:'迟到的结果',calls:1});};}));
 run();await vi.waitFor(()=>expect(model.executeTarget).toHaveBeenCalled());
 const stopped=runner.control('cancel');release();await stopped;await settled();
 expect(target.commit).not.toHaveBeenCalled();expect(applied).not.toHaveBeenCalled();expect(runner.status().phase).toBe('ready');await runner.shutdown();
});
it('stop racing a successful document commit preserves completion and undo instead of claiming cancellation',async()=>{
 const {runner,target,run,settled,applied}=await setup();
 Object.assign(target,{resultReceipt:{documentId:'owned-range',revision:1,locators:[{kind:'text',text:'迟到结果'}]}});
 let release!:()=>void;target.commit.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=()=>{target.canUndo=true;resolve();};}));
 run();await vi.waitFor(()=>expect(target.commit).toHaveBeenCalled());
 const stopped=runner.control('cancel');release();await stopped;await settled();
 expect(runner.status()).toMatchObject({phase:'done',canUndo:true,resultFeedback:null});expect(applied).toHaveBeenCalledOnce();expect(target.commit).toHaveBeenCalledOnce();await runner.shutdown();
});
it('publishes one acknowledged result receipt and clears it on finish',async()=>{
 const {runner,target,run,settled}=await setup();
 Object.assign(target,{resultReceipt:{documentId:'owned-range',revision:1,locators:[{kind:'text',text:'真实回读'}]}});
 run();await settled();
 expect(runner.status().resultFeedback).toMatchObject({phase:'done',available:true,targetKind:'word-live',receipt:{documentId:'owned-range',revision:1}});
 const id=runner.status().resultFeedback?.id;expect(runner.status().resultFeedback?.id).toBe(id);
 await runner.control('finish');expect(runner.status().resultFeedback).toBeNull();await runner.shutdown();
});
