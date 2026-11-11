import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {FileRunner} from '../src/file-runner';
import {ClipboardStore} from '../src/clipboard/store';
import {WordLiveTarget} from '../src/targets/word-live';
const model=vi.hoisted(()=>({planTarget:vi.fn(),executeTarget:vi.fn()}));
vi.mock('../src/agent-client',()=>({AgentClient:class{planTarget=model.planTarget;executeTarget=model.executeTarget;}}));
let root='';afterEach(()=>{if(root)fs.rmSync(root,{recursive:true,force:true});vi.resetAllMocks();});
async function setup(interruptDefault=false){
 root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-word-revisions-'));
 const store=new ClipboardStore(path.join(root,'clipboard')),source=store.add({type:'text',body:{text:'参考'}});
 const snapshot={protocolVersion:2,anchorId:'a',body:'原文',bodyOoxml:'original',paragraphs:[],location:{paragraphIndex:0,before:'',after:'原文',section:''}};
 const request=vi.fn(async(_id:string,method:string)=>method==='read'?snapshot:{ok:true});
 const target=new WordLiveTarget({request} as any,'session','测试',snapshot,store),runner=new FileRunner(root,store);
 model.planTarget.mockResolvedValue({title:'插入',summary:'插入',actions:['插入'],suggestions:['插入'],questions:[],needsClarification:false});
 let counter=0;model.executeTarget.mockImplementation(async(input:any)=>{await input.invoke('prepare_word_insertion',{text:`第${++counter}版`});return {summary:'准备完成',calls:1};});
 const settled=()=> (runner as any).chain as Promise<void>;
 if(interruptDefault){
  model.planTarget.mockImplementationOnce((_input,signal:AbortSignal)=>new Promise(resolve=>{
   signal.addEventListener('abort',()=>resolve({suggestions:['迟到的推荐']}),{once:true});
  }));
 }
 await runner.useTarget(target);runner.ensurePlanned();
 if(interruptDefault)await vi.waitFor(()=>expect(model.planTarget).toHaveBeenCalledOnce());
 else await settled();
 const run=()=>runner.run({itemIds:[source.id],instruction:'补充内容',actionIndex:0,continuation:target.revision>0});
 run();await settled();return {runner,target,request,run,settled};
}
it('keeps V1 during model failure and cancellation, and then supports V2 → V1 → V0',async()=>{
 const {runner,target,request,run,settled}=await setup();const first=runner.status().result;
 model.executeTarget.mockRejectedValueOnce(new Error('模型不可用'));run();await settled();
 expect(runner.status()).toMatchObject({phase:'done',revision:1,canUndo:true,result:first,error:'模型不可用'});
 let release!:()=>void;model.executeTarget.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({summary:'迟到',calls:0});}));
 run();await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
 const stop=runner.control('cancel');release();await stop;
 expect(runner.status()).toMatchObject({phase:'done',revision:1,result:first,error:''});
 expect(request.mock.calls.filter(call=>call[1]==='undo')).toHaveLength(0);
 run();await settled();expect(target.revision).toBe(2);
 await runner.control('undo');expect(runner.status()).toMatchObject({phase:'done',revision:1,result:first,canUndo:true});
 model.planTarget.mockClear();
 await runner.control('undo');
 let releaseTarget!:()=>void;const original=request.getMockImplementation()!;
 request.mockImplementation(async(id,method)=>method==='release'?new Promise(resolve=>{releaseTarget=()=>resolve({ok:true});}):original(id,method));
 const finishing=runner.control('finish');await vi.waitFor(()=>expect(releaseTarget).toBeTypeOf('function'));
 runner.ensurePlanned();await settled();expect(runner.status().targetKind).toBeUndefined();
 releaseTarget();await finishing;await settled();
 expect(runner.status()).toMatchObject({phase:'idle',canUndo:false});
 expect(model.planTarget).not.toHaveBeenCalled();await runner.shutdown();
});
it('reports a lost write response as uncertain rather than falsely preserving V1 or allowing retry',async()=>{
 const {runner,request,run,settled}=await setup();
 const original=request.getMockImplementation()!;
 request.mockImplementation(async(id,method)=>{if(method==='insert')throw new Error('response lost');return original(id,method);});
 run();await settled();expect(runner.status()).toMatchObject({phase:'error',revision:1,canUndo:false,mutationUncertain:true});
 expect(run()).toMatchObject({ok:false});expect(await runner.control('cancel')).toMatchObject({ok:false});await runner.shutdown();
});
it('keeps V1 undo available when the host explicitly rejects a candidate before any mutation',async()=>{
 const {runner,request,run,settled}=await setup();const original=request.getMockImplementation()!;
 request.mockImplementation(async(id,method)=>{if(method==='insert')throw Object.assign(new Error('文档已改变'),{mutationStarted:false});return original(id,method);});
 run();await settled();expect(runner.status()).toMatchObject({phase:'done',revision:1,canUndo:true,error:'文档已改变'});await runner.shutdown();
});
it('stopping during planning also retains the prior committed version',async()=>{
 const {runner,run,settled}=await setup();let release!:()=>void;
 model.planTarget.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({title:'调整',summary:'调整',actions:[],questions:[],needsClarification:false});}));
 run();await vi.waitFor(()=>expect(release).toBeTypeOf('function'));const stop=runner.control('cancel');release();await stop;await settled();
 expect(runner.status()).toMatchObject({phase:'done',revision:1,canUndo:true});await runner.shutdown();
});

it('accepts an explicit request while the default plan is in flight and discards its late result',async()=>{
 const {runner,target,request}=await setup(true);
 expect(model.planTarget).toHaveBeenCalledTimes(2);
 expect(model.planTarget.mock.calls[1][0].conversation[0].text).toBe('补充内容');
 expect(target.revision).toBe(1);
 expect(request.mock.calls.filter(call=>call[1]==='insert')).toHaveLength(1);
 await runner.shutdown();
});
