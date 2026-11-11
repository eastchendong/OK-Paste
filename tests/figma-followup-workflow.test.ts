import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {FileRunner} from '../src/file-runner';import {ClipboardStore} from '../src/clipboard/store';
import {FigmaLiveTarget,type FigmaSnapshot} from '../src/targets/figma-live';
import type {OfficeBridge} from '../src/office-live/bridge';
const model=vi.hoisted(()=>({plan:vi.fn(),execute:vi.fn(),suggest:vi.fn()}));
vi.mock('../src/agent-client',()=>({AgentClient:class{planTarget=model.plan;executeTarget=model.execute;}}));
vi.mock('../src/agent-core/followup-recommendations',()=>({FollowupRecommender:class{suggest=model.suggest;}}));
const roots:string[]=[];afterEach(()=>{vi.resetAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const png=(v:string)=>'data:image/png;base64,'+Buffer.from(v).toString('base64');
const art={width:100,height:100,shapes:[{type:'ellipse',name:'主体',group:'主体',cx:50,cy:50,rx:20,ry:30,fill:'#aadddd',stroke:'#123456',strokeWidth:2,opacity:1}]};
async function setup(scene:string){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-figma-followup-'));roots.push(root);
 const store=new ClipboardStore(path.join(root,'sources')),item=store.add({type:'text',body:{text:'独立矢量验收资料'}});
 let revision=0,hideCurrentImage=false;
 const snapshot=():FigmaSnapshot=>({protocolVersion:2,anchorId:'a',version:'page-'+revision,document:{name:'隔离测试',page:{id:'p',name:'当前页'},pages:[],items:[{name:'已有风格'}],scope:'current-page'},target:{nodeId:'frame',name:'新作品',width:100,height:100},previews:hideCurrentImage?[]:[{nodeId:'frame',dataUrl:png('committed-'+revision)},{nodeId:'style',dataUrl:png(revision?'later-style':'original-style')}]});
 const request=async(_session:string,method:string)=>{if(method==='read')return snapshot();if(method==='preview')return {image:png('candidate')};if(method==='apply'){revision++;return {resultId:'result-'+revision};}if(method==='undo'){revision--;return {resultId:revision?'result-'+revision:''};}return {ok:true};};
 const target=new FigmaLiveTarget(root,{request} as unknown as OfficeBridge,'s','新作品',snapshot()),runner=new FileRunner(root,store);
 model.plan.mockResolvedValue({title:'按现有风格生成作品',summary:'保留原图层',actions:['生成作品'],suggestions:['生成作品'],questions:[],needsClarification:false,writingScene:scene});
 model.execute.mockImplementation(async(args:any)=>{
  const candidate:any=await args.invoke('prepare_figma_artwork',{artwork:art,summary:'作品已准备'});
  await args.invoke('review_figma_artwork',{candidateId:candidate.candidateId,approved:true,issues:[]});return {summary:'准备完成',calls:2};
 });
 await runner.useTarget(target);runner.ensurePlanned();await (runner as any).chain;
 return {runner,target,store,run:(instruction='执行已确认要求')=>runner.run({itemIds:[item.id],instruction,actionIndex:0,continuation:target.revision!>0}),settled:()=> (runner as any).chain as Promise<void>,hideImage:()=>{hideCurrentImage=true;}};
}
for(const scene of ['vector-character','vector-icon','vector-empty-state'])it('reads committed artwork and frozen visual references for '+scene,async()=>{
 model.suggest.mockResolvedValue({scene,options:[{label:'减少细节',instruction:'精简本任务作品的装饰，保持风格和语义。',direction:'vector-simplify'}]});
 const {runner,target,run,settled}=await setup(scene);expect(run().ok).toBe(true);await settled();
 await vi.waitFor(()=>expect(runner.status().followupRecommendations?.status).toBe('ready'));
 expect(runner.status()).toMatchObject({phase:'done',revision:1,canUndo:true,followupRecommendations:{scene}});
 const facts=model.suggest.mock.calls[0][0];
 expect(JSON.parse(facts.currentResult)).toEqual(art);expect(facts.baseline.target.nodeId).toBe('frame');
 expect(facts.images).toEqual([png('committed-1'),png('original-style')]);
 expect(facts.imageRoles).toEqual(['current-committed-frame','frozen-reference-frame']);
 expect(facts.intent.writingScene).toBe(scene);expect(target.revision).toBe(1);
 await runner.shutdown();
});
it('passes the accepted first-round vector scene directly to execution without replanning the default',async()=>{
 model.suggest.mockResolvedValue({scene:'vector-icon',options:[]});
 const {runner,run,settled}=await setup('vector-icon');
 expect(run('').ok).toBe(true);await settled();
 expect(runner.status()).toMatchObject({phase:'done',revision:1});
 expect(model.execute.mock.calls[0][0].plan.writingScene).toBe('vector-icon');
 expect(model.plan).toHaveBeenCalledTimes(1);await runner.shutdown();
});
it('passes prior vector intent to a custom planner and preserves it when the new plan omits metadata',async()=>{
 model.suggest.mockResolvedValue({scene:'vector-icon',options:[]});
 const {runner,run,settled}=await setup('vector-icon');
 model.plan.mockResolvedValue({title:'减少内部刻度',summary:'保持图标语义',actions:[],questions:[],needsClarification:false});
 run('减少内部刻度，其他保持');await settled();
 expect(model.plan.mock.calls[1][0].intent).toMatchObject({writingScene:'vector-icon'});
 expect(model.execute.mock.calls[0][0].plan.writingScene).toBe('vector-icon');
 await runner.shutdown();
});
it('lets an explicit new vector purpose override the previous scene',async()=>{
 model.suggest.mockResolvedValue({scene:'vector-empty-state',options:[]});
 const {runner,run,settled}=await setup('vector-icon');
 model.plan.mockResolvedValue({title:'改为空状态插画',summary:'本次新要求',actions:[],questions:[],needsClarification:false,writingScene:'vector-empty-state'});
 run('这次改成搜索无结果的空状态插画');await settled();
 expect(model.execute.mock.calls[0][0].plan.writingScene).toBe('vector-empty-state');
 await runner.shutdown();
});
it('exposes actual execution sources rather than all planning sources and clears them at finish',async()=>{
 model.suggest.mockResolvedValue({scene:'vector-icon',options:[]});
 const {runner,store,run,settled}=await setup('vector-icon');
 const selected=runner.status().plannedSourceIds[0];const other=store.add({type:'text',body:{text:'未选择的下一份资料'}});
 runner.ensurePlanned();await settled();expect(new Set(runner.status().plannedSourceIds)).toEqual(new Set([selected,other.id]));
 run('执行已选资料');expect((runner.status() as any).executionSourceIds).toEqual([selected]);await settled();
 expect((runner.status() as any).executionSourceIds).toEqual([selected]);
 run('只简化当前图标');await settled();await runner.control('undo');
 expect((runner.status() as any).executionSourceIds).toEqual([selected]);
 await runner.control('finish');expect((runner.status() as any).executionSourceIds).toEqual([]);await runner.shutdown();
});
it('restores matching version recommendations on undo and discards late results after undo or finish',async()=>{
 const pending:((v:any)=>void)[]=[];model.suggest.mockImplementation(()=>new Promise(resolve=>pending.push(resolve)));
 const {runner,run,settled}=await setup('vector-icon');run();await settled();await vi.waitFor(()=>expect(pending).toHaveLength(1));
 const first={scene:'vector-icon',options:[{label:'减少刻度',instruction:'只减少本任务图标刻度，保留语义和风格。',direction:'vector-simplify'}]};
 pending[0](first);await vi.waitFor(()=>expect(runner.status().followupRecommendations?.status).toBe('ready'));
 run();await settled();await vi.waitFor(()=>expect(pending).toHaveLength(2));
 await runner.control('undo');pending[1]({scene:'vector-icon',options:[{label:'过期建议'}]});await Promise.resolve();
 expect(runner.status()).toMatchObject({revision:1,followupRecommendations:{revision:1,options:first.options}});
 run();await settled();await vi.waitFor(()=>expect(pending).toHaveLength(3));
 await runner.control('finish');pending[2](first);await Promise.resolve();
 expect(runner.status()).toMatchObject({phase:'idle',followupRecommendations:undefined});await runner.shutdown();
});
it('keeps the successful artwork and free input if its committed image is unavailable',async()=>{
 const {runner,target,run,settled,hideImage}=await setup('vector-empty-state');hideImage();run();await settled();
 expect(target.revision).toBe(1);expect(runner.status()).toMatchObject({phase:'done',canUndo:true,followupRecommendations:{status:'unavailable',options:[]}});
 expect(model.suggest).not.toHaveBeenCalled();await runner.shutdown();
});
it('keeps unknown and zero-option Figma recommendations explicit instead of reverting to fixed buttons',async()=>{
 for(const scene of [null,'vector-icon']){
  model.suggest.mockResolvedValue({scene,options:[]});const {runner,run,settled}=await setup('vector-icon');
  run();await settled();await vi.waitFor(()=>expect(runner.status().followupRecommendations?.status).toBe('ready'));
  expect(runner.status().followupRecommendations).toMatchObject({scene,options:[]});await runner.shutdown();
 }
});
