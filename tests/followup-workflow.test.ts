import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {FileRunner} from '../src/file-runner';
import {ClipboardStore} from '../src/clipboard/store';
import type {EditableTarget} from '../src/targets/editable-target';
const model=vi.hoisted(()=>({plan:vi.fn(),execute:vi.fn(),suggest:vi.fn()}));
vi.mock('../src/agent-client',()=>({AgentClient:class{planTarget=model.plan;executeTarget=model.execute;}}));
vi.mock('../src/agent-core/followup-recommendations',()=>({FollowupRecommender:class{suggest=model.suggest;}}));
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});vi.resetAllMocks();});
const recommendations=(label='分工改成分点')=>({scene:'document-fragment',options:[{label,instruction:'保留已有资料和配图，将本次分工说明改为分点，不改其他部分。',direction:'structure'}]});
class Target implements EditableTarget{
 name='第二节';kind='word-live';file='';previewPath='';applyImmediately=true;versions:string[]=[];candidate='';
 get revision(){return this.versions.length;}get canUndo(){return this.revision>0;}get mutationUncertain(){return false;}
 get originalUnchanged(){return !this.revision;}get previewChanged(){return !!this.candidate;}get previewText(){return this.candidate||this.versions.at(-1)||'';}
 fingerprint(){return 'fixed';}
 async read(){return {fingerprint:this.fingerprint(),kind:this.kind,currentInsertion:this.versions.at(-1),location:{section:'二、分工'},capabilities:'只改本任务片段'};}
 begin(){this.candidate='';}tools(){return [{name:'prepare_text',description:'只改本次文字',inputSchema:{}}];}
 async invoke(_name:string,args:Record<string,unknown>){this.candidate=String(args.text);return {prepared:true};}
 commit(){this.versions.push(this.candidate);this.candidate='';}
 undo(){this.versions.pop();}cancel(){this.candidate='';}
}
async function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-followup-'));roots.push(root);
 const store=new ClipboardStore(path.join(root,'clipboard'));const item=store.add({type:'text',body:{text:'活动资料'}});
 const target=new Target(),runner=new FileRunner(root,store);
 model.plan.mockResolvedValue({title:'补充分工',summary:'基于资料补充第二节',suggestions:['补充分工'],actions:[],questions:[],needsClarification:false,writingScene:'document-fragment'});
 model.execute.mockImplementation(async(input:any)=>{await input.invoke('prepare_text',{text:`分工第${target.revision+1}版`});return {summary:'已准备',calls:1};});
 const settled=()=> (runner as any).chain as Promise<void>;
 const run=()=>runner.run({itemIds:[item.id],actionIndex:0,instruction:'补充分工',continuation:target.revision>0});
 await runner.useTarget(target);runner.ensurePlanned();await settled();
 return {runner,target,item,store,run,settled};
}
it('delivers the confirmed result while recommendations are pending, with the first-round intent and frozen sources',async()=>{
 let resolve!:(value:any)=>void;model.suggest.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const {runner,target,item,run,settled}=await setup();run();await settled();
 await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));
 expect(runner.status()).toMatchObject({phase:'done',revision:1,followupRecommendations:{status:'loading',revision:1}});
 const facts=model.suggest.mock.calls[0][0];
 expect(facts).toMatchObject({currentResult:'分工第1版',intent:{writingScene:'document-fragment'}});
 expect(facts.sources.map((s:any)=>s.id)).toEqual([item.id]);
 expect(target.revision).toBe(1);
 resolve(recommendations());await vi.waitFor(()=>expect(runner.status().followupRecommendations?.status).toBe('ready'));
 await runner.shutdown();
});
it('rejects late V1 suggestions, refreshes V2 once, and restores cached V1 suggestions on undo',async()=>{
 model.suggest.mockResolvedValueOnce(recommendations()).mockResolvedValueOnce(recommendations('结论放在开头'));
 const {runner,run,settled}=await setup();run();await settled();
 await vi.waitFor(()=>expect(runner.status().followupRecommendations?.status).toBe('ready'));
 run();await settled();await vi.waitFor(()=>expect(runner.status().followupRecommendations?.options[0].label).toBe('结论放在开头'));
 await runner.control('undo');
 expect(runner.status()).toMatchObject({revision:1,followupRecommendations:{revision:1,options:[{label:'分工改成分点'}]}});
 runner.ensurePlanned();expect(model.suggest).toHaveBeenCalledTimes(2);
 await runner.shutdown();
});
it('ignores a provider that returns after a newer revision or task finish',async()=>{
 const resolve:((v:any)=>void)[]=[];
 model.suggest.mockImplementation(()=>new Promise(r=>resolve.push(r)));
 const {runner,run,settled}=await setup();run();await settled();await vi.waitFor(()=>expect(resolve).toHaveLength(1));
 run();await settled();await vi.waitFor(()=>expect(resolve).toHaveLength(2));
 resolve[0](recommendations('旧版建议'));await Promise.resolve();
 expect(runner.status().followupRecommendations).toMatchObject({revision:2,status:'loading'});
 await runner.control('finish');resolve[1](recommendations('迟到建议'));await Promise.resolve();
 expect(runner.status()).toMatchObject({phase:'idle'});expect(runner.status().followupRecommendations).toBeUndefined();
 await runner.shutdown();
});
it('keeps successful content, undo and free input usable when recommendations fail',async()=>{
 model.suggest.mockRejectedValue(new Error('模型不可用'));
 const {runner,run,settled}=await setup();run();await settled();
 await vi.waitFor(()=>expect(runner.status().followupRecommendations?.status).toBe('unavailable'));
 expect(runner.status()).toMatchObject({phase:'done',revision:1,canUndo:true,error:''});
 expect(run().ok).toBe(true);await settled();await runner.shutdown();
});
it('does not generate after a rejected edit, and preserves the successful revision recommendations',async()=>{
 model.suggest.mockResolvedValue(recommendations());
 const {runner,run,settled}=await setup();run();await settled();
 await vi.waitFor(()=>expect(runner.status().followupRecommendations?.status).toBe('ready'));
 model.execute.mockRejectedValueOnce(new Error('生成失败'));run();await settled();
 expect(runner.status()).toMatchObject({revision:1,phase:'done',followupRecommendations:{status:'ready',revision:1}});
 expect(model.suggest).toHaveBeenCalledOnce();await runner.shutdown();
});
it('keeps table/image/design quick edits outside the writing feature',async()=>{
 model.suggest.mockResolvedValue(recommendations());
 const {runner,target,run,settled}=await setup();target.kind='excel-live';run();await settled();
 expect(runner.status().followupRecommendations).toBeUndefined();expect(model.suggest).not.toHaveBeenCalled();await runner.shutdown();
});
it('does not replan from newly collected material while a completed revision is receiving suggestions',async()=>{
 let resolve!:(value:any)=>void;model.suggest.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const {runner,store,item,run,settled}=await setup();run();await settled();
 await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));
 store.add({type:'text',body:{text:'另一个任务的资料'}});const plans=model.plan.mock.calls.length;
 runner.ensurePlanned();expect(model.plan).toHaveBeenCalledTimes(plans);
 expect(model.suggest.mock.calls[0][0].sources.map((s:any)=>s.id)).toEqual([item.id]);
 resolve(recommendations());await vi.waitFor(()=>expect(runner.status().followupRecommendations?.status).toBe('ready'));await runner.shutdown();
});
it('skips text recommendations for a Word image-only patch',async()=>{
 const {runner,target,run,settled}=await setup();const read=target.read.bind(target);
 vi.spyOn(target,'read').mockImplementation(async()=>({...await read(),currentInsertion:{blocks:[{type:'image',imageId:'pic'}]}} as any));
 run();await settled();expect(runner.status()).toMatchObject({phase:'done',followupRecommendations:{status:'ready',options:[]}});
 expect(model.suggest).not.toHaveBeenCalled();await runner.shutdown();
});
it('a failed post-commit context read does not turn a successful write into a failure',async()=>{
 const {runner,target,run,settled}=await setup();const read=target.read.bind(target);
 vi.spyOn(target,'read').mockImplementation(async()=>{if(target.revision)throw new Error('加载项暂时断开');return read();});
 run();await settled();expect(runner.status()).toMatchObject({phase:'done',revision:1,canUndo:true,error:'',followupRecommendations:{status:'unavailable'}});
 expect(model.suggest).not.toHaveBeenCalled();await runner.shutdown();
});
