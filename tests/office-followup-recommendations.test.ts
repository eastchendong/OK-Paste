import {expect,it} from 'vitest';
import {FollowupRecommender,type FollowupInput} from '../src/agent-core/followup-recommendations';
function range(address:string,cells:unknown[][]){
 return {address,rowCount:cells.length,columnCount:cells[0].length,formulas:cells,text:cells.map(row=>row.map(v=>v==null?'':String(v))),numberFormat:cells.map(row=>row.map(()=>'General'))};
}
function table(cells:unknown[][],headers?:string[]):FollowupInput{
 const original=range('数据!B3:D5',cells.map(row=>row.map(()=>null)));
 const workbook={sheets:[{name:'数据',usedRange:headers?range('数据!A1:D2',[['无关列',...headers],['原记录','001','原同学','已有备注']]):null}]};
 return {intent:{title:headers?'按已有表头追加报名记录':'把资料整理成表格'},currentResult:JSON.stringify(cells),
  context:{kind:'excel-live',worksheet:'数据',selection:range('数据!B3:D5',cells),workbook,currentUpdate:cells,capabilities:'仅改固定矩形值/公式，不改格式，不增行列'},
  baseline:{kind:'excel-live',worksheet:'数据',selection:original,workbook},
  sources:[{id:'brief',type:'text',source:{url:'https://example.org/brief'},body:{text:'虚构报名资料'}}],
  images:[],conversation:[{role:'user',text:headers?'按已有表头追加记录':'根据资料整理报名表'}],
  tools:[{name:'prepare_excel_update',description:'仅改本次选区',inputSchema:{}}]} as FollowupInput;
}
function slide(fits=['cover','cover']):FollowupInput{
 return {intent:{title:'用两张来源图片补齐本页用户画像头像'},currentResult:'补齐两张头像',
  context:{kind:'powerpoint-live',selection:{shapeIds:['new-a','new-b']},currentEdit:{replacements:fits.map((fit,i)=>({shapeId:i?'new-b':'new-a',imageId:'person-'+i,fit})),texts:[]},capabilities:'图片仅支持 contain/cover，保留位置、大小、其他对象'},
  baseline:{kind:'powerpoint-live',selection:{shapeIds:['slot-a','slot-b']},currentPage:{shapes:[{id:'reference',type:'Picture'},{id:'slot-a',type:'Shape'},{id:'slot-b',type:'Shape'}]}},
  sources:[{id:'person-0',type:'image'},{id:'person-1',type:'image'}],images:[],conversation:[{role:'user',text:'保留原头像，补齐两个空位'}],
  tools:[{name:'prepare_powerpoint_edit',description:'替换选中对象，支持 contain/cover',inputSchema:{}}]} as FollowupInput;
}
const option=(direction:string,label:string)=>({direction,label,instruction:'只在本任务范围执行该调整，保留其他事实、数值、公式、图片、位置和格式。'});
async function suggest(input:FollowupInput,scene:string,suggestions:unknown[]){
 return new FollowupRecommender('/tmp',async()=>({tool_calls:[{id:'r',function:{name:'present_followup_recommendations',arguments:JSON.stringify({scene,suggestions})}}]})).suggest(input,new AbortController().signal);
}
it('supports a newly created table and only deduplicates demonstrably identical records with an explicit identity field',async()=>{
 const input=table([['报名编号','姓名','备注'],['001','小林','上午参加'],['001','小林','上午参加']]);
 const items=[option('normalize-text','统一状态写法'),option('length','精简备注'),option('deduplicate','相同记录去重')];
 await expect(suggest(input,'table-create',items)).resolves.toEqual({scene:'table-create',options:items});
});
it('never offers deduplication based on matching names or conflicting records',async()=>{
 for(const cells of [
  [['姓名','部门','备注'],['小林','设计','上午'],['小林','设计','上午']],
  [['报名编号','姓名','备注'],['001','小林','上午'],['001','小林','下午']],
 ]){
  const result=await suggest(table(cells),'table-create',[option('deduplicate','合并重复记录')]);
  expect(result.options).toEqual([]);
 }
});
it('only offers splitting fields when the same captured rectangle has an unused column',async()=>{
 const withSpace=table([['姓名','联系信息',null],['小林','电话和邮箱',null]]);
 expect((await suggest(withSpace,'table-create',[option('split-fields','联系方式分列')])).options).toHaveLength(1);
 const full=table([['姓名','联系信息',0],['小林','电话和邮箱',false]]);
 expect((await suggest(full,'table-create',[option('split-fields','联系方式分列')])).options).toEqual([]);
});
it('uses original headers for appended rows and only cites into an existing notes/source column',async()=>{
 const input=table([['002','新同学','较长说明'],['003','另一位','较长说明']],['报名编号','姓名','备注']);
 const items=[option('match-existing','与原表写法一致'),option('cite-source','资料来源写进备注')];
 expect((await suggest(input,'table-append',items)).options).toEqual(items);
 const noNotes=table([['002','新同学','已报名']],['报名编号','姓名','状态']);
 expect((await suggest(noNotes,'table-append',[option('cite-source','新增来源列')])).options).toEqual([]);
});
it('does not run new-table recommendations on an originally populated formula selection',async()=>{
 const input=table([[130,260,0],[20,40,0]]);
 (input as any).baseline.selection=range('数据!B3:D4',[[130,'=B3*2',0],[20,'=B4*2',0]]);
 const recommender=new FollowupRecommender('/tmp',async()=>{throw new Error('should not request recommendations');});
 await expect(recommender.suggest(input,new AbortController().signal)).resolves.toEqual({scene:null,options:[]});
});
it('offers only a useful fit alternative for two inserted avatars, preserving mapped images',async()=>{
 const result=await suggest(slide(),'persona-avatars',[option('image-contain','完整显示人物'),option('image-cover','填满头像框')]);
 expect(result.options.map(x=>x.label)).toEqual(['完整显示人物']);
 const filled=await suggest(slide(['contain','contain']),'persona-avatars',[option('image-contain','完整显示人物'),option('image-cover','填满头像框')]);
 expect(filled.options.map(x=>x.label)).toEqual(['填满头像框']);
});
it('does not treat a read-only slide capture or an unrelated single picture as editable avatar completion',async()=>{
 for(const count of [0,1]){
  const input=slide();(input.context as any).selection.shapeIds=count?['new-a']:[];
  const result=await new FollowupRecommender('/tmp',async()=>{throw new Error('must not request');}).suggest(input,new AbortController().signal);
  expect(result).toEqual({scene:null,options:[]});
 }
});
it('rejects scene recommendations that belong to a different target capability',async()=>{
 expect((await suggest(slide(),'table-create',[option('length','精简说明')])).options).toEqual([]);
});

it('does not use formulas as identity or equality evidence for deleting records',async()=>{
 for(const formula of [{formula:'=ROW()'},'=ROW()']){
  const key=table([['ID','姓名','备注'],[formula,'小林','已报名'],[formula,'小林','已报名']]);
  expect((await suggest(key,'table-create',[option('deduplicate','相同记录去重')])).options).toEqual([]);
  const other=table([['ID','姓名','备注'],['001','小林',formula],['001','小林',formula]]);
  expect((await suggest(other,'table-create',[option('deduplicate','相同记录去重')])).options).toEqual([]);
 }
});
it('keeps explicitly typed equals-prefixed text eligible while rejecting identifier conflicts',async()=>{
 const literal=table([['ID','姓名','备注'],[{text:'=001'},'小林',{text:'=待确认'}],[{text:'=001'},'小林',{text:'=待确认'}]]);
 expect((await suggest(literal,'table-create',[option('deduplicate','相同记录去重')])).options).toHaveLength(1);
 const conflict=table([['ID','姓名','备注'],['001','小林','上午'],['001','小林','上午'],['001','小林','下午']]);
 expect((await suggest(conflict,'table-create',[option('deduplicate','相同记录去重')])).options).toEqual([]);
});
