import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {FileRunner} from '../src/file-runner';
import {ClipboardStore} from '../src/clipboard/store';
import type {EditableTarget} from '../src/targets/editable-target';
const mocks=vi.hoisted(()=>({plan:vi.fn(),execute:vi.fn(),followup:vi.fn()}));
vi.mock('../src/agent-client',()=>({AgentClient:class{planTarget=mocks.plan;executeTarget=mocks.execute;}}));
vi.mock('../src/agent-core/initial-recommendations',()=>({InitialRecommender:class{supports(){return true;}async suggest(){return {recommendation:{text:'整理本次资料'},modelMs:1};}}}));
vi.mock('../src/agent-core/followup-recommendations',()=>({FollowupRecommender:class{suggest=mocks.followup;}}));
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});vi.unstubAllGlobals();vi.resetAllMocks();});
const names:Record<string,string>={'word-live':'prepare_word_insertion','input-live':'prepare_text','excel-live':'prepare_excel_update','powerpoint-live':'prepare_powerpoint_edit'};
class Target implements EditableTarget{
 name='固定合成位置';file='';previewPath='';applyImmediately=true;candidate='';versions:string[]=[];reads=0;uncertain=false;commits=0;
 constructor(public kind:string){}
 get revision(){return this.versions.length;}get canUndo(){return this.revision>0;}get mutationUncertain(){return this.uncertain;}
 get previewChanged(){return Boolean(this.candidate);}get originalUnchanged(){return this.revision===0;}get previewText(){return this.candidate||this.versions.at(-1)||'';}
 fingerprint(){return 'fixed';}
 async read(){this.reads++;return {fingerprint:'fixed',kind:this.kind,currentInsertion:this.versions.at(-1),location:{section:'固定章节'}};}
 begin(){this.candidate='';}cancel(){this.candidate='';}
 tools(){return [{name:names[this.kind],description:'只准备本任务候选',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}];}
 async invoke(_name:string,args:Record<string,unknown>){this.candidate=String(args.text);return {prepared:true};}
 commit(){this.commits++;this.versions.push(this.candidate);this.candidate='';return {summary:'已写入合成稿'};}
 undo(){this.versions.pop();}
}
async function setup(kind='word-live'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-direct-workflow-'));roots.push(root);fs.mkdirSync(path.join(root,'.local'));fs.writeFileSync(path.join(root,'.local/recommendations-config.json'),JSON.stringify({apiKey:'synthetic-key'}));
 const store=new ClipboardStore(path.join(root,'clipboard'));const a=store.add({type:'text',body:{text:'资料一'}}),b=store.add({type:'text',body:{text:'资料二'}});
 const target=new Target(kind),runner=new FileRunner(root,store);
 const fetchImpl=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'run',function:{name:names[kind],arguments:JSON.stringify({text:'成功第'+(target.revision+1)+'版'})}}]}}]})));
 vi.stubGlobal('fetch',fetchImpl);mocks.followup.mockResolvedValue({scene:null,options:[]});
 const settled=()=> (runner as any).chain as Promise<void>;
 await runner.useTarget(target);runner.ensurePlanned();await settled();
 const run=(instruction='整理两份资料')=>runner.run({itemIds:[a.id,b.id],instruction,actionIndex:0,continuation:target.revision>0});
 return {runner,target,run,settled,fetchImpl,root};
}
it.each(Object.keys(names))('%s 自定义、多资料和第二版均不再规划，并保留逐级撤销',async kind=>{
 const {runner,target,run,settled,fetchImpl}=await setup(kind);run();await settled();expect(runner.status()).toMatchObject({phase:'done',revision:1,executionMetrics:{provider:'deepseek-flash',requests:1}});
 // Capture, pre-generation read and post-commit followup read; no extra full read before commit.
 expect(target.reads).toBe(3);expect(fetchImpl).toHaveBeenCalledOnce();
 run('缩短一点，保留其他内容');await settled();expect(runner.status()).toMatchObject({phase:'done',revision:2});expect(fetchImpl).toHaveBeenCalledTimes(2);expect(target.commits).toBe(2);
 const facts=JSON.parse(JSON.parse(fetchImpl.mock.calls[1][1].body).messages[1].content[0].text);expect(facts.context.currentInsertion).toBe('成功第1版');expect(facts.instruction).toContain('缩短');expect(facts.sources).toHaveLength(2);
 expect(mocks.plan).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled();
 await runner.control('undo');expect(target.versions).toEqual(['成功第1版']);await runner.control('undo');expect(target.versions).toEqual([]);await runner.shutdown();
});
it('第二轮接口失败保留第一版及撤销，不回退旧模型',async()=>{
 const {runner,target,run,settled,fetchImpl}=await setup();run();await settled();fetchImpl.mockResolvedValueOnce(new Response('',{status:429}));run();await settled();expect(runner.status()).toMatchObject({phase:'done',revision:1,canUndo:true});expect(target.commits).toBe(1);expect(fetchImpl).toHaveBeenCalledTimes(2);expect(mocks.plan).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled();await runner.shutdown();
});
it('首次与继续修改的追问均不写入，上一版保留',async()=>{
 const {runner,target,run,settled,fetchImpl}=await setup();const clarification=()=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'q',function:{name:'request_clarification',arguments:JSON.stringify({question:'请明确需要保留哪一条事实？'})}}]}}]}));
 fetchImpl.mockResolvedValueOnce(clarification());run();await settled();expect(runner.status()).toMatchObject({phase:'ready',questions:['请明确需要保留哪一条事实？']});expect(target.commits).toBe(0);
 run('保留全部事实');await settled();expect(target.revision).toBe(1);
 const clarifiedFacts=JSON.parse(JSON.parse(fetchImpl.mock.calls[1][1].body).messages[1].content[0].text);expect(clarifiedFacts.conversation).toContainEqual({role:'user',text:'整理两份资料'});expect(clarifiedFacts.conversation).toContainEqual({role:'assistant',text:'请明确需要保留哪一条事实？'});fetchImpl.mockResolvedValueOnce(clarification());run();await settled();expect(runner.status()).toMatchObject({phase:'done',revision:1,canUndo:true,error:'请明确需要保留哪一条事实？'});expect(target.commits).toBe(1);await runner.shutdown();
});
it('收到模型响应前停止，不提交候选',async()=>{
 const {runner,target,run,settled,fetchImpl}=await setup();let release!:(r:Response)=>void;fetchImpl.mockImplementationOnce(()=>new Promise(r=>{release=r;}));run();await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
 const stopping=runner.control('cancel');release(new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{tool_calls:[{id:'late',function:{name:'prepare_word_insertion',arguments:'{"text":"迟到内容"}'}}]}}]})));await stopping;await settled();expect(target.commits).toBe(0);expect(target.versions).toHaveLength(0);await runner.shutdown();
});
it('真正的宿主提交失败不会被当作候选错误重试',async()=>{
 const {runner,target,run,settled,fetchImpl}=await setup();vi.spyOn(target,'commit').mockImplementation(()=>{target.uncertain=true;throw new Error('写入结果未确认');});run();await settled();expect(runner.status()).toMatchObject({mutationUncertain:true,phase:'error'});expect(fetchImpl).toHaveBeenCalledOnce();expect(runner.run({instruction:'再试',actionIndex:0}).ok).toBe(false);await runner.shutdown();
});
