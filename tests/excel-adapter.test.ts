import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createExcelAdapter} from '../office-live/excel-adapter.js';

class Range {
 isNullObject=false;
 rowIndex=1;columnIndex=1;hasSpill:boolean|null=false;savedAsArray:boolean|null=false;worksheet:any;tables:any[]=[];merged:any[]=[];
 private data:any[][];private mask:boolean[][];
 constructor(public address:string,formulas:any[][],public text:string[][],public numberFormat:string[][]){this.data=formulas;this.mask=formulas.map(row=>row.map(cell=>typeof cell==='string'&&cell.startsWith('=')));}
 get formulas(){return this.data;}
 set formulas(cells:any[][]){this.mask=cells.map(row=>row.map(cell=>typeof cell==='string'&&cell.startsWith('=')));this.data=cells.map(row=>row.map(cell=>typeof cell==='string'&&cell.startsWith("'")?cell.slice(1):cell));this.text=this.data.map(row=>row.map(cell=>cell==='=1/0'?'#DIV/0!':String(cell)));}
 get valueTypes(){return this.text.map(row=>row.map(cell=>cell==='#DIV/0!'?'Error':'Double'));}
 getTables(){return {items:this.tables,load(){}};}
 getMergedAreasOrNullObject(){return {isNullObject:!this.merged.length,areas:{items:this.merged,load(){}},load(){}};}
 getSpecialCellsOrNullObject(){const items=this.mask.flatMap((row,r)=>row.flatMap((value,c)=>value?[{rowIndex:this.rowIndex+r,columnIndex:this.columnIndex+c,rowCount:1,columnCount:1}]:[]));return {isNullObject:!items.length,areas:{items,load(){}},load(){}};}
 get rowCount(){return this.formulas.length;}
 get columnCount(){return this.formulas[0]?.length||0;}
 load(){}
}
class Sheet {
 protection={protected:false,load(){}};
 constructor(public name:string,public used:Range){used.worksheet=this;}
 load(){}
 getUsedRangeOrNullObject(){return this.used;}
}
function setup(){
 const selected=new Range('数据!B2:C3',[[1,2],[3,4]],[['1','2'],['3','4']],[['0','0'],['0','0']]);
 const used=new Range('数据!A1:C3',[['指标','Q1','Q2'],['收入',1,2],['成本',3,4]],[['指标','Q1','Q2'],['收入','1','2'],['成本','3','4']],[['常规','常规','常规'],['常规','0','0'],['常规','0','0']]);
 const sheet=new Sheet('数据',used);
 selected.worksheet=sheet;
 const tracked=new Set<Range>();
 const context={workbook:{getSelectedRange:()=>selected,worksheets:{items:[sheet],getActiveWorksheet:()=>sheet,load(){}}},trackedObjects:{add:(range:Range)=>tracked.add(range),remove:(range:Range)=>tracked.delete(range)},sync:vi.fn(async()=>{})};
 const Excel={run:vi.fn(async(first:any,second?:any)=>(second||first)(context))};
 return {execute:createExcelAdapter(Excel),selected,used,sheet,tracked,context};
}
describe('Office.js Excel adapter',()=>{
 beforeEach(()=>vi.restoreAllMocks());
 it('binds a native drop only if the actual Office selection matches the native cell receipt',async()=>{
  const s=setup();
  await expect(s.execute('capture',{nativeDrop:{host:'excel',positioned:true,cellAddress:'D9'}})).rejects.toMatchObject({mutationStarted:false,message:expect.stringContaining('落点单元格已变化')});
  expect(s.tracked.size).toBe(0);expect(s.selected.formulas).toEqual([[1,2],[3,4]]);
  // A physical drop selects one cell, even if a larger range used to be selected.
  s.selected.address='数据!$D$9';s.selected.formulas=[[7]];
  const snapshot=await s.execute('capture',{nativeDrop:{host:'excel',positioned:true,cellAddress:'D9'}});
  expect(snapshot.selection.address).toBe('数据!$D$9');expect(snapshot.selection.rowCount).toBe(1);expect(s.tracked.size).toBe(1);
 });
 it('captures the complete used workbook and tracked selection, then applies and safely undoes only that range',async()=>{
  const {execute,selected,tracked}=setup();
  const captured=await execute('capture',{documentUrl:'file:///测试.xlsx'});
  expect(captured).toMatchObject({worksheet:'数据',selection:{address:'数据!B2:C3',rowCount:2,columnCount:2},workbook:{name:'file:///测试.xlsx'}});
  expect(captured.workbook.sheets[0].usedRange.formulas[0]).toEqual(['指标','Q1','Q2']);
  expect(tracked.has(selected)).toBe(true);
  await execute('apply',{anchorId:captured.anchorId,expectedVersion:captured.version,expectedRevision:0,cells:[[10,'=B2*2'],[30,40]]});
  expect(selected.formulas).toEqual([[10,'=B2*2'],[30,40]]);
  await execute('undo',{anchorId:captured.anchorId,expectedRevision:1});expect(selected.formulas).toEqual([[1,2],[3,4]]);
  await execute('release',{anchorId:captured.anchorId});expect(tracked.has(selected)).toBe(false);
 });
 it('rejects stale workbooks and duplicate writes',async()=>{
  const {execute,used,selected}=setup();const captured=await execute('capture',{});
  used.formulas[1][1]=99;
  await expect(execute('apply',{anchorId:captured.anchorId,expectedVersion:captured.version,expectedRevision:0,cells:[[10,20],[30,40]]})).rejects.toThrow('工作簿内容');
  used.formulas[1][1]=1;
  const fresh=await execute('read',{anchorId:captured.anchorId});
  await execute('apply',{anchorId:captured.anchorId,expectedVersion:fresh.version,expectedRevision:0,cells:[[10,20],[30,40]]});
  await expect(execute('apply',{anchorId:captured.anchorId,expectedVersion:fresh.version,expectedRevision:0,cells:[[10,20],[30,40]]})).rejects.toThrow('请勿重复');
  selected.formulas[0][0]=11;
  await expect(execute('undo',{anchorId:captured.anchorId,expectedRevision:1})).rejects.toMatchObject({mutationStarted:false,message:expect.stringContaining('继续编辑')});
 });
 it('refuses oversized workbooks instead of presenting a partial context',async()=>{
  const {execute,used}=setup();
  used.formulas=Array.from({length:501},()=>Array(100).fill(1));used.text=used.formulas.map(row=>row.map(String));used.numberFormat=used.formulas.map(row=>row.map(()=> '0'));
  await expect(execute('capture',{})).rejects.toThrow('5 万格');
 });
 it('restores two revisions including literal formula-like text, clears nulls, and leaves outside edits intact',async()=>{
  const {execute,selected,used}=setup();const original=[[{text:'=不是公式'},'+编号'],['-编号',4]];
  selected.formulas=[["'=不是公式","'+编号"],["'-编号",4]];
  const captured=await execute('capture'),args={anchorId:captured.anchorId};
  expect(captured.selection.formulaMask).toEqual([[false,false],[false,false]]);
  await execute('apply',{...args,expectedRevision:0,expectedVersion:captured.version,cells:[[10,{formula:'=B2*2'}],[null,{text:'=1+1'}]]});
  const first=await execute('read',args);expect(first.selection.formulas).toEqual([[10,'=B2*2'],['','=1+1']]);expect(first.selection.formulaMask).toEqual([[false,true],[false,false]]);
  await execute('apply',{...args,expectedRevision:1,expectedVersion:first.version,cells:[[20,'=1/0'],[30,40]]}).then(result=>expect(result.warnings[0]).toContain('#DIV/0!'));
  used.formulas[0][0]='用户在其他位置的编辑';
  await execute('undo',{...args,expectedRevision:2});expect(selected.formulas).toEqual(first.selection.formulas);
  await execute('undo',{...args,expectedRevision:1});expect(selected.formulas).toEqual(original.map(row=>row.map(cell=>typeof cell==='object'?cell.text:cell)));expect(used.formulas[0][0]).toContain('用户');
 });
 it('rejects unsafe areas before a mutation, including merges whose top-left is outside selection',async()=>{
  for(const kind of ['protected','merge','spill','array','table']){
   const s=setup();if(kind==='protected')s.sheet.protection.protected=true;if(kind==='merge')s.used.merged=[{rowIndex:0,columnIndex:0,rowCount:3,columnCount:3}];if(kind==='spill')s.selected.hasSpill=null;if(kind==='array')s.selected.savedAsArray=true;if(kind==='table')s.selected.tables=[{id:'t'}];
   await expect(s.execute('capture')).rejects.toMatchObject({mutationStarted:false});expect(s.selected.formulas).toEqual([[1,2],[3,4]]);expect(s.tracked.size).toBe(0);
  }
 });
 it('freezes host writes after a sync failure and never replays them',async()=>{
  const s=setup(),captured=await s.execute('capture');let fail=true;
  s.context.sync.mockImplementation(async()=>{if(s.selected.formulas[0][0]===10&&fail){fail=false;throw new Error('lost sync');}});
  await expect(s.execute('apply',{anchorId:captured.anchorId,expectedRevision:0,expectedVersion:captured.version,cells:[[10,20],[30,40]]})).rejects.toMatchObject({mutationStarted:true});
  await expect(s.execute('undo',{anchorId:captured.anchorId,expectedRevision:0})).rejects.toThrow('未确认');
 });
});
