import {afterEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {FileRunner} from '../src/file-runner';
import {ClipboardStore} from '../src/clipboard/store';
import {ExcelLiveTarget} from '../src/targets/excel-live';
import {FigmaLiveTarget} from '../src/targets/figma-live';
const model=vi.hoisted(()=>({planTarget:vi.fn(),executeTarget:vi.fn()}));
vi.mock('../src/agent-client',()=>({AgentClient:class{planTarget=model.planTarget;executeTarget=model.executeTarget;}}));
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});vi.resetAllMocks();});
async function setup(host:'excel'|'figma'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),`tuotie-${host}-revisions-`));roots.push(root);
 const store=new ClipboardStore(path.join(root,'sources')),source=store.add({type:'text',body:{text:'合成参考'}});
 const snapshot:any=host==='excel'?{protocolVersion:2,anchorId:'a',version:'v',worksheet:'数据',selection:{address:'数据!B2',rowCount:1,columnCount:1,formulas:[[1]],text:[['1']],numberFormat:[['0']]},workbook:{name:'合成.xlsx',sheets:[]}}:{protocolVersion:2,anchorId:'a',version:'v',document:{name:'合成稿',items:[]},target:{name:'新角色'},previews:[]};
 const resultIds:string[]=[];let counter=0;
 const request=vi.fn(async(_id:string,method:string,_args?:any)=>{if(method==='read')return snapshot;if(method==='preview')return {image:'data:image/png;base64,AQID'};if(method==='apply'){resultIds.push(`r${++counter}`);return {resultId:resultIds.at(-1)};}if(method==='undo'){resultIds.pop();return {resultId:resultIds.at(-1)||''};}return {ok:true};});
 const target=host==='excel'?new ExcelLiveTarget({request}as any,'s','合成',snapshot):new FigmaLiveTarget(root,{request}as any,'s','合成',snapshot);
 const runner=new FileRunner(root,store);
 model.planTarget.mockResolvedValue({title:'更新',summary:'更新',actions:['更新'],suggestions:['更新'],questions:[],needsClarification:false});
 model.executeTarget.mockImplementation(async(input:any)=>{
  if(host==='excel')await input.invoke('prepare_excel_update',{cells:[[counter+10]]});
  else{const candidate=await input.invoke('prepare_figma_artwork',{summary:'新角色',artwork:{width:100,height:100,shapes:[{type:'ellipse',name:'主体',group:'主体',cx:50,cy:50,rx:30,ry:30,fill:'#123456',stroke:'none',strokeWidth:0,opacity:1}]}});await input.invoke('review_figma_artwork',{candidateId:candidate.candidateId,approved:true,issues:[]});}
  return {summary:'已准备',calls:1};
 });
 const settled=()=> (runner as any).chain as Promise<void>;
 await runner.useTarget(target);runner.ensurePlanned();await settled();
 const run=()=>runner.run({itemIds:[source.id],instruction:'更新本任务内容',actionIndex:0,continuation:Boolean(target.revision)});
 run();await settled();return {runner,target,request,run,settled,store};
}
for(const host of ['excel','figma']as const)describe(`${host} revision lifecycle`,()=>{
 it('retains V1 on model failure and stop, then restores V2 → V1 → V0',async()=>{
  const {runner,target,request,run,settled}=await setup(host),first=runner.status().result;
  model.executeTarget.mockRejectedValueOnce(new Error('模型失败'));run();await settled();expect(runner.status()).toMatchObject({phase:'done',revision:1,result:first,canUndo:true,error:'模型失败'});
  let release!:()=>void;model.executeTarget.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({summary:'迟到',calls:0});}));
  run();await vi.waitFor(()=>expect(release).toBeTypeOf('function'));const stop=runner.control('cancel');release();await stop;
  expect(runner.status()).toMatchObject({phase:'done',revision:1,result:first,error:''});expect(request.mock.calls.filter(call=>call[1]==='undo')).toHaveLength(0);
  run();await settled();expect(target.revision).toBe(2);await runner.control('undo');expect(runner.status()).toMatchObject({phase:'done',revision:1,result:first});
  await runner.control('undo');await settled();expect(runner.status()).toMatchObject({phase:'idle',revision:0,canUndo:false});await runner.shutdown();
 });
 it('keeps undo on confirmed prewrite refusal but freezes an uncertain mutation',async()=>{
  const {runner,request,run,settled,store}=await setup(host),original=request.getMockImplementation()!;
  request.mockImplementation(async(id,method,args)=>{if(method==='apply')throw Object.assign(new Error('冲突'),{mutationStarted:false});return original(id,method,args);});
  run();await settled();expect(runner.status()).toMatchObject({phase:'done',revision:1,canUndo:true,mutationUncertain:false,error:'冲突'});
  request.mockImplementation(async(id,method,args)=>{if(method==='apply')throw new Error('回执丢失');return original(id,method,args);});
  run();await settled();expect(runner.status()).toMatchObject({phase:'error',revision:1,canUndo:false,mutationUncertain:true});
  model.planTarget.mockClear();store.add({type:'text',body:{text:'断连后新采集的资料'}});runner.ensurePlanned();
  expect(runner.status()).toMatchObject({phase:'error',mutationUncertain:true});expect(model.planTarget).not.toHaveBeenCalled();
  expect(run()).toMatchObject({ok:false});expect(await runner.control('cancel')).toMatchObject({ok:false});await runner.shutdown();
 });
});
