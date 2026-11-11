import {describe,it,expect,vi} from 'vitest';
import {ExcelLiveTarget} from '../src/targets/excel-live';
import type {ExcelSnapshot} from '../src/office-live/bridge';
const snapshot=(version='v1'):ExcelSnapshot=>({protocolVersion:2,anchorId:'range-a',version,worksheet:'数据',selection:{address:'数据!B2:C3',rowCount:2,columnCount:2,formulas:[[1,2],[3,4]],text:[['1','2'],['3','4']],numberFormat:[['0','0'],['0','0']]},workbook:{name:'测试.xlsx',sheets:[{name:'数据',usedRange:{address:'数据!A1:C3',rowCount:3,columnCount:3,formulas:[['指标','Q1','Q2'],['收入',1,2],['成本',3,4]],text:[['指标','Q1','Q2'],['收入','1','2'],['成本','3','4']],numberFormat:[['常规','常规','常规'],['常规','0','0'],['常规','0','0']]}}]}});
function setup(){
 const request=vi.fn(async(_session:string,method:string)=>method==='read'?snapshot():{ok:true});
 const target=new ExcelLiveTarget({request} as any,'session-a','数据 · B2:C3',snapshot());return {request,target};
}
describe('tracked Excel selection target',()=>{
 it('provides complete workbook and selection context without writing during preview',async()=>{
  const {request,target}=setup();const context=await target.read();
  expect(context.workbook.sheets[0].usedRange?.formulas[0]).toEqual(['指标','Q1','Q2']);
  expect(context.selection.address).toBe('数据!B2:C3');expect(context).not.toHaveProperty('version');
  target.begin();await target.invoke('prepare_excel_update',{cells:[[10,'=B2*2'],[30,40]]});
  expect(target.previewText).toBe('10\t=B2*2\n30\t40');expect(target.originalUnchanged).toBe(true);
  expect(request.mock.calls.map(call=>call[1])).toEqual(['read']);
 });
 it('requires an exact rectangular matrix matching the frozen selection',async()=>{
  const {target}=setup();target.begin();
  await expect(target.invoke('prepare_excel_update',{cells:[[1,2]]})).rejects.toThrow('2 行 × 2 列');
  await expect(target.invoke('prepare_excel_update',{cells:[[1],[2,3]]})).rejects.toThrow('2 行 × 2 列');
 });
 it('commits once against the generation version and safely undoes',async()=>{
  const {request,target}=setup();target.begin();await target.invoke('prepare_excel_update',{cells:[[10,20],[30,40]]});
  request.mockResolvedValueOnce(snapshot('changed'));await target.read();await target.commit();
  expect(request).toHaveBeenLastCalledWith('session-a','apply',{anchorId:'range-a',expectedVersion:'v1',expectedRevision:0,cells:[[10,20],[30,40]]});
  await expect(target.commit()).rejects.toThrow();expect(request.mock.calls.filter(call=>call[1]==='apply')).toHaveLength(1);
  expect(target.canUndo).toBe(true);await target.undo();expect(request).toHaveBeenLastCalledWith('session-a','undo',{anchorId:'range-a',expectedRevision:1});
 });
 it('freezes after an uncertain write so a retry cannot duplicate changes',async()=>{
  const {request,target}=setup();target.begin();await target.invoke('prepare_excel_update',{cells:[[10,20],[30,40]]});
  request.mockRejectedValueOnce(new Error('response lost'));await expect(target.commit()).rejects.toThrow('response lost');
  await expect(target.commit()).rejects.toThrow();expect(request.mock.calls).toHaveLength(1);
 });
 it('replaces its own applied matrix when the user continues adjusting',async()=>{
  const {request,target}=setup();await target.begin();await target.invoke('prepare_excel_update',{cells:[[10,20],[30,40]]});await target.commit();
  await target.begin();await target.invoke('prepare_excel_update',{cells:[[11,21],[31,41]]});await target.commit();
  expect(request.mock.calls.filter(call=>call[1]==='apply')).toHaveLength(2);
  expect(request.mock.calls.filter(call=>call[1]==='undo')).toHaveLength(0);
  expect(target.revision).toBe(2);
  expect(target.canUndo).toBe(true);
  await target.undo();expect(target.revision).toBe(1);await target.undo();expect(target.revision).toBe(0);
 });
 it('never commits an earlier valid candidate after a malformed retry',async()=>{
  const {target}=setup();target.begin();await target.invoke('prepare_excel_update',{cells:[[1,2],[3,4]]});
  await expect(target.invoke('prepare_excel_update',{cells:[[NaN,2],[3,4]]})).rejects.toThrow();expect(target.previewChanged).toBe(false);await expect(target.commit()).rejects.toThrow('没有可应用');
 });
});
