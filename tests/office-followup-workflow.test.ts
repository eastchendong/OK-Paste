import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {FileRunner} from '../src/file-runner';
import {ClipboardStore} from '../src/clipboard/store';
import type {EditableTarget} from '../src/targets/editable-target';
const model=vi.hoisted(()=>({plan:vi.fn(),execute:vi.fn(),suggest:vi.fn()}));
vi.mock('../src/agent-client',()=>({AgentClient:class{planTarget=model.plan;executeTarget=model.execute;}}));
vi.mock('../src/agent-core/followup-recommendations',()=>({FollowupRecommender:class{suggest=model.suggest;}}));
const roots:string[]=[];
afterEach(()=>{vi.resetAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function range(cells:unknown[][]){return {address:'数据!B3:D4',rowCount:2,columnCount:3,formulas:cells,text:cells.map(row=>row.map(v=>v==null?'':String(v))),numberFormat:[['General','General','General'],['General','General','General']]};}
/** Deterministic host fixture; only the model boundary is replaced. */
class OfficeTarget implements EditableTarget{
 name='独立验收';file='';previewPath='';applyImmediately=true;versions:any[]=[];candidate:any;
 constructor(readonly kind:string,readonly scene:string){}
 get revision(){return this.versions.length;}get canUndo(){return this.revision>0;}get originalUnchanged(){return !this.revision;}
 get previewChanged(){return Boolean(this.candidate);}get previewText(){return '写入回执摘要，不是实际单元格';}
 get contextImage(){return this.kind==='powerpoint-live'?'data:image/png;base64,'+(this.revision?'AQ==':'AA=='):undefined;}
 fingerprint(){return 'fixed';}
 async read(){
  if(this.kind==='excel-live')return {kind:this.kind,fingerprint:'fixed',worksheet:'数据',
   selection:range(this.versions.at(-1)??[[null,null,null],[null,null,null]]),currentUpdate:this.versions.at(-1)??null,
   workbook:{sheets:[{name:'数据',usedRange:this.scene==='table-append'?{...range([['无关列','编号','姓名','备注'],['原行','001','原同学','保留']]),address:'数据!A1:D2'}:null}]},
   capabilities:'只改本次选区的值和公式，保留格式'};
  const ids=this.revision?['new-a','new-b']:['slot-a','slot-b'];
  return {kind:this.kind,fingerprint:'fixed',selection:{shapeIds:ids},captureScope:'selection',currentEdit:this.versions.at(-1)??null,
   currentPage:{shapes:[{id:'reference',type:'Picture'},...ids.map(id=>({id,type:'Shape'}))]},capabilities:'只替换本任务图片，支持 contain/cover'};
 }
 begin(){this.candidate=undefined;}
 tools(){return [{name:this.kind==='excel-live'?'prepare_excel_update':'prepare_powerpoint_edit',description:'固定范围',inputSchema:{}}];}
 async invoke(_name:string,args:any){this.candidate=args.cells??args;return {prepared:true};}
 commit(){this.versions.push(structuredClone(this.candidate));this.candidate=undefined;}
 undo(){this.versions.pop();}cancel(){this.candidate=undefined;}
}
async function setup(scene:string){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-office-followup-'));roots.push(root);
 const store=new ClipboardStore(path.join(root,'sources'));const item=store.add({type:'text',body:{text:'独立验收资料'}});
 const target=new OfficeTarget(scene==='persona-avatars'?'powerpoint-live':'excel-live',scene),runner=new FileRunner(root,store);
 model.plan.mockResolvedValue({title:scene==='persona-avatars'?'补齐两张用户画像头像':'把报名资料按表头整理',summary:'保留原内容',actions:['执行'],suggestions:['执行'],questions:[],needsClarification:false,writingScene:scene});
 model.execute.mockImplementation(async(input:any)=>{
  await input.invoke(target.tools()[0].name,target.kind==='excel-live'?{cells:[['002','新同学','长备注'],['003','另一位','说明']]}:{replacements:[{shapeId:'new-a',imageId:item.id,fit:'cover'},{shapeId:'new-b',imageId:item.id,fit:'cover'}],texts:[]});
  return {summary:'已准备',calls:1};
 });
 const settled=()=> (runner as any).chain as Promise<void>;
 await runner.useTarget(target);runner.ensurePlanned();await settled();
 const run=()=>runner.run({itemIds:[item.id],instruction:'执行已确认的整理任务',actionIndex:0,continuation:target.revision>0});
 return {runner,target,run,settled};
}
for(const scene of ['table-create','table-append','persona-avatars'])it(`starts dynamic recommendations after committing ${scene}, carrying the first-round intent`,async()=>{
 model.suggest.mockImplementation(async(input:any)=>({scene,options:[{label:'本版调整',instruction:'保留原范围，执行当前允许的变化。',direction:scene==='persona-avatars'?'image-contain':'length'}]}));
 const {runner,run,settled}=await setup(scene);run();await settled();
 await vi.waitFor(()=>expect(runner.status().followupRecommendations?.status).toBe('ready'));
 expect(runner.status()).toMatchObject({phase:'done',revision:1,followupRecommendations:{scene}});
 const facts=model.suggest.mock.calls[0][0];
 expect(facts.intent.writingScene).toBe(scene);
 if(scene==='persona-avatars')expect(facts.images[0]).toBe('data:image/png;base64,AQ==');
 else{
  expect(JSON.parse(facts.currentResult)).toEqual([['002','新同学','长备注'],['003','另一位','说明']]);
  expect(facts.baseline.selection.formulas).toEqual([[null,null,null],[null,null,null]]);
  if(scene==='table-append')expect(facts.baseline.referenceHeaders).toEqual(['编号','姓名','备注']);
 }
 await runner.shutdown();
});
it('restores the matching table suggestions after undo and discards a late request',async()=>{
 const resolve:((value:any)=>void)[]=[];model.suggest.mockImplementation(()=>new Promise(r=>resolve.push(r)));
 const {runner,run,settled}=await setup('table-append');run();await settled();
 await vi.waitFor(()=>expect(resolve).toHaveLength(1));
 resolve[0]({scene:'table-append',options:[{label:'精简备注',instruction:'只精简本次备注，保留其他字段。',direction:'length'}]});
 await vi.waitFor(()=>expect(runner.status().followupRecommendations?.status).toBe('ready'));
 run();await settled();await vi.waitFor(()=>expect(resolve).toHaveLength(2));
 await runner.control('undo');resolve[1]({scene:'table-append',options:[{label:'旧回调',instruction:'不应显示',direction:'length'}]});
 await Promise.resolve();
 expect(runner.status()).toMatchObject({revision:1,followupRecommendations:{revision:1,options:[{label:'精简备注'}]}});
 await runner.shutdown();
});

it('keeps ordinary PowerPoint fit controls available when the task is not persona completion',async()=>{
 model.suggest.mockResolvedValue({scene:null,options:[]});
 const {runner,run,settled}=await setup('persona-avatars');run();await settled();
 await vi.waitFor(()=>expect(runner.status().followupRecommendations).toBeUndefined());
 expect(runner.status()).toMatchObject({phase:'done',revision:1,canUndo:true});
 await runner.shutdown();
});
it('keeps an explicitly recognized avatar scene with zero suggestions instead of fabricating fixed options',async()=>{
 model.suggest.mockResolvedValue({scene:'persona-avatars',options:[]});
 const {runner,run,settled}=await setup('persona-avatars');run();await settled();
 await vi.waitFor(()=>expect(runner.status().followupRecommendations?.status).toBe('ready'));
 expect(runner.status().followupRecommendations).toMatchObject({scene:'persona-avatars',options:[]});await runner.shutdown();
});
