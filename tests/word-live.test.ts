import {describe,it,expect,vi} from 'vitest';
import {WordLiveTarget} from '../src/targets/word-live';
import type {WordSnapshot} from '../src/office-live/bridge';
const snapshot=(xml='original'):WordSnapshot=>({protocolVersion:2,anchorId:'range-a',body:'前文\r后文',bodyOoxml:xml,paragraphs:[{text:'前文',style:'Normal'}],location:{paragraphIndex:0,before:'前文',after:'后文',section:''}});
function setup(){
 const request=vi.fn(async(_session:string,method:string,_args?:Record<string,unknown>)=>method==='read'?snapshot():{ok:true});
 const target=new WordLiveTarget({request} as any,'session-a','测试文稿',snapshot());return {request,target};
}
describe('tracked Word insertion target',()=>{
 it('shares the complete body and location, excludes OOXML from model context, and does not write for preview',async()=>{
  const {request,target}=setup();const context=await target.read();
  expect(context.body).toBe('前文\r后文');expect(context.location.before).toBe('前文');expect(context).not.toHaveProperty('bodyOoxml');
  target.begin();await target.invoke('prepare_word_insertion',{text:'新增内容'});
  expect(target.previewChanged).toBe(true);expect(target.originalUnchanged).toBe(true);
  expect(request.mock.calls.map(call=>call[1])).toEqual(['read']);
 });
 it('commits once to the saved anchor, preserving the generation-time version despite a later read',async()=>{
  const {request,target}=setup();target.begin();await target.invoke('prepare_word_insertion',{text:'新增内容'});
  request.mockResolvedValueOnce(snapshot('changed'));await target.read();await target.commit();
  expect(request).toHaveBeenLastCalledWith('session-a','insert',{anchorId:'range-a',expectedOoxml:'original',expectedRevision:0,text:'新增内容'});
  await expect(target.commit()).rejects.toThrow();expect(request.mock.calls.filter(call=>call[1]==='insert')).toHaveLength(1);
  expect(target.canUndo).toBe(true);await target.undo();expect(request).toHaveBeenLastCalledWith('session-a','undo',{anchorId:'range-a',expectedRevision:1});
 });
 it('blocks duplicate insertions after an uncertain write and keeps the document untouched on cancel',async()=>{
  const {request,target}=setup();target.begin();await target.invoke('prepare_word_insertion',{text:'新增内容'});
  request.mockRejectedValueOnce(new Error('response lost'));await expect(target.commit()).rejects.toThrow('response lost');
  await expect(target.commit()).rejects.toThrow();expect(request.mock.calls).toHaveLength(1);
  target.cancel();expect(target.previewChanged).toBe(false);await expect(target.begin()).rejects.toThrow('结果未确认');
 });
 it('replaces its own applied result when the user continues adjusting',async()=>{
  const {request,target}=setup();await target.begin();await target.invoke('prepare_word_insertion',{text:'第一版'});await target.commit();
  await target.begin();await target.invoke('prepare_word_insertion',{text:'第二版'});await target.commit();
  expect(request.mock.calls.filter(call=>call[1]==='insert')).toHaveLength(2);
  expect(request.mock.calls.filter(call=>call[1]==='undo')).toHaveLength(0);
  expect(target.revision).toBe(2);await target.undo();expect(target.previewText).toBe('第一版');expect(target.canUndo).toBe(true);
  await target.undo();expect(target.revision).toBe(0);expect(target.canUndo).toBe(false);
 });
 it('keeps the committed version when a new candidate is cancelled or rejected before writing',async()=>{
  const {request,target}=setup();await target.begin();await target.invoke('prepare_word_insertion',{text:'第一版'});await target.commit();
  await target.begin();await target.invoke('prepare_word_insertion',{text:'取消的候选'});target.cancel();
  expect(target.previewText).toBe('第一版');expect(target.revision).toBe(1);
  await target.begin();await target.invoke('prepare_word_insertion',{text:'过期候选'});
  request.mockRejectedValueOnce(Object.assign(new Error('文档已改变'),{mutationStarted:false}));
  await expect(target.commit()).rejects.toThrow('文档已改变');target.cancel();expect(target.canUndo).toBe(true);expect(target.previewText).toBe('第一版');
 });
 it('clears an earlier candidate if a later patch is invalid',async()=>{
  const {target}=setup();await target.begin();await target.invoke('prepare_word_insertion',{text:'不应写入'});
  await expect(target.invoke('prepare_word_patch',{blocks:[{type:'image',imageId:'not-selected'}]})).rejects.toThrow();
  expect(target.previewChanged).toBe(false);await expect(target.commit()).rejects.toThrow();
 });
 it('resolves only selected image IDs and sends one compiled rich candidate to the host',async()=>{
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  const request=vi.fn(async()=>({ok:true})),store={get:vi.fn(()=>({type:'image'})),readContent:vi.fn(()=>png)};
  const current=snapshot();current.location.before='前文\r';
  const target=new WordLiveTarget({request} as any,'session','test',current,store as any);
  await target.begin(['selected']);
  const blocks=[{type:'paragraph',runs:[{text:'标题',bold:true}]},{type:'image',imageId:'selected'}];
  await target.invoke('prepare_word_patch',{blocks});expect(request).not.toHaveBeenCalled();await target.commit();
  expect(request).toHaveBeenCalledWith('session','insert',expect.objectContaining({ooxml:expect.stringContaining('<w:b w:val="1"/>'),expectedRevision:0}));
  expect(store.readContent).toHaveBeenCalledExactlyOnceWith('selected');
  await target.begin(['other']);await expect(target.invoke('prepare_word_patch',{blocks})).rejects.toThrow('本轮');
  expect(store.readContent).toHaveBeenCalledOnce();expect(target.canUndo).toBe(true);
 });
 it('offers only inline text inside an existing paragraph, protecting its original paragraph formatting',async()=>{
  const {target}=setup();expect(target.tools().map(tool=>tool.name)).toEqual(['prepare_word_insertion']);
  await target.begin();await expect(target.invoke('prepare_word_patch',{blocks:[{type:'paragraph',align:'center',runs:[{text:'标题'}]}]})).rejects.toThrow('段首');
  expect(target.previewChanged).toBe(false);
 });
 it('refuses an old host instead of silently inserting rich content as plain text',async()=>{
  const {target,request}=setup();request.mockResolvedValueOnce({...snapshot(),protocolVersion:undefined});
  await expect(target.read()).rejects.toThrow('重新打开');await expect(target.begin()).rejects.toThrow('重新打开');
 });
 it('refuses oversized full documents instead of truncating them as full context',async()=>{
  const {request,target}=setup();request.mockResolvedValueOnce({...snapshot(),body:'x'.repeat(180001)});
  await expect(target.read()).rejects.toThrow('没有截取部分正文冒充全文');
 });
});
it('does not restart planning when Word exports new package metadata for unchanged context',async()=>{
 const request=vi.fn(async()=>snapshot('new package metadata'));
 const target=new WordLiveTarget({request} as any,'session','test',snapshot('old package metadata'));
 const version=target.fingerprint();await target.read();expect(target.fingerprint()).toBe(version);
});
it('rejects a whole-document candidate that repeats both sides of the insertion point, then accepts only the new fragment',async()=>{
 const state={...snapshot(),location:{paragraphIndex:3,section:'第二节',before:'第一节背景说明，这是已有的原始段落。\r第二节活动安排\r',after:'第三节后续事项\r这段原文必须保留。'}};
 const request=vi.fn(async(_session:string,_method:string,_args?:Record<string,unknown>)=>state),target=new WordLiveTarget({request} as any,'session','test',state);
 await target.begin();await target.invoke('prepare_word_insertion',{text:'一个候选'});
 await expect(target.invoke('prepare_word_insertion',{text:state.location.before+'新增活动说明。\r'+state.location.after})).rejects.toThrow('只提交本任务新增');
 expect(target.previewChanged).toBe(false);await target.invoke('prepare_word_insertion',{text:'新增活动说明。'});expect(target.previewChanged).toBe(true);
});
it('uses paragraph insertion at a paragraph boundary, while an explicit inline request remains inline',async()=>{
 const state={...snapshot(),location:{paragraphIndex:1,before:'前文\r',after:'后续标题',section:''}};
 const request=vi.fn(async()=>state),target=new WordLiveTarget({request} as any,'session','test',state);
 await target.begin();await target.invoke('prepare_word_insertion',{text:'独立说明。'});await target.commit();
 expect(request.mock.calls.at(-1)).toEqual(['session','insert',expect.objectContaining({ooxml:expect.stringContaining('<w:p>')})]);
 const inlineRequest=vi.fn(async(_session:string,_method:string,_args?:Record<string,unknown>)=>state),inline=new WordLiveTarget({request:inlineRequest} as any,'session','test',state);
 await inline.begin();await inline.invoke('prepare_word_insertion',{text:'引导词：',layout:'inline'});await inline.commit();
 expect(inlineRequest.mock.calls.at(-1)?.[2]).not.toHaveProperty('ooxml');
});
