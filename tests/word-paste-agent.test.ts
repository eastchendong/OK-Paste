import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {DesktopAgent} from '../src/desktop-agent';import {ClipboardStore} from '../src/clipboard/store';
import type {SceneRunner} from '../src/scene-runner';import type {WordBridge} from '../src/office-live/bridge';
vi.mock('../src/agent-client',()=>({AgentClient:class {
 async planTarget(){return {title:'插入研究发现',summary:'根据正文和资料补充',actions:['插入'],questions:[],needsClarification:false,suggestions:['补充研究发现','插入背景摘要','补充后续建议']};}
 async executeTarget(input:any){await input.invoke('prepare_word_insertion',{text:'新增研究发现。'});return {summary:'已准备插入预览',calls:[]};}
}}));
let root='';afterEach(()=>{if(root)fs.rmSync(root,{recursive:true,force:true});});
it('pins the live Word task across focus changes, inserts immediately, keeps undo, and releases on finish',async()=>{
 root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-word-agent-'));const store=new ClipboardStore(path.join(root,'clipboard'));
 const source=store.add({type:'text',body:{text:'合成测试资料'}});
 const scenes={phase:'ready',status:()=>({phase:'ready'}),ensurePlanned(){},async shutdown(){},async control(){return {ok:true};}} as unknown as SceneRunner;
 const agent=new DesktopAgent(root,scenes,store,vi.fn());
 const snapshot={protocolVersion:2,anchorId:'a',body:'正文',bodyOoxml:'original',paragraphs:[{text:'正文',style:'Normal'}],location:{paragraphIndex:0,before:'',after:'正文',section:''}};
 const request=vi.fn(async(_id:string,method:string)=>['read','capture'].includes(method)?snapshot:{ok:true});
 const bridge={select:()=> 'session',request} as unknown as WordBridge;
 try{
  const focus={appName:'Word',bundleId:'com.microsoft.Word',windowTitle:'测试文稿'};
  await agent.updateFocus(focus);await (agent.files as any).chain;
  expect(agent.run({destinationId:'focused',itemIds:[source.id],actionIndex:0}).ok).toBe(false);
  const capture=agent.beginWordPaste(focus,bridge);
  await agent.updateFocus({...focus,selectedText:'正在变化的选区'});
  await capture;await (agent.files as any).chain;
  expect(agent.status()).toMatchObject({targetKind:'word-live',phase:'ready',actions:['补充研究发现']});
  expect(agent.status()).toMatchObject({targetLocation:'正文第 1 段'});
  await expect(agent.beginWordPaste({appName:'Word',bundleId:'com.microsoft.Word',windowTitle:'另一位置'},bridge)).rejects.toThrow('仍使用原位置');
  expect(request.mock.calls.filter(c=>c[1]==='capture')).toHaveLength(1);
  await agent.updateFocus({appName:'其他应用',bundleId:'com.example.other'});
  expect(agent.status()).toMatchObject({targetKind:'word-live',targetName:'测试文稿'});
  expect(agent.run({destinationId:'office',itemIds:[source.id],actionIndex:0}).ok).toBe(true);await (agent.files as any).chain;
  expect(agent.status()).toMatchObject({phase:'done',canUndo:true,taskArchived:false});
  await expect(agent.beginWordPaste({appName:'Word',bundleId:'com.microsoft.Word'},bridge)).rejects.toThrow('先在妥帖结束');
  expect(request.mock.calls.filter(c=>c[1]==='insert')).toHaveLength(1);expect(store.list()).toHaveLength(1);
  store.archive([source.id]);await agent.ensurePlanned();
  expect(agent.status()).toMatchObject({phase:'done',canUndo:true,anchor:expect.any(Object)});
  const later=store.add({type:'text',body:{text:'下一次任务的新资料'}});
  await agent.control('finish');await (agent.files as any).chain;
  expect(store.get(source.id)?.archivedAt).toBeTruthy();
  expect(store.list().map(item=>item.id)).toEqual([later.id]);
  expect(agent.status()).toMatchObject({targetKind:'focused-text',targetName:'其他应用'});
  expect(request.mock.calls.some(c=>c[1]==='release')).toBe(true);
 }finally{await agent.shutdown();}
});

it('stopping before a write releases the saved position and allows a new task without archiving references',async()=>{
 root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-word-reset-'));const store=new ClipboardStore(path.join(root,'clipboard'));
 store.add({type:'text',body:{text:'测试资料'}});
 const scenes={phase:'ready',status:()=>({phase:'ready'}),ensurePlanned(){},async shutdown(){}} as unknown as SceneRunner;
 const agent=new DesktopAgent(root,scenes,store,vi.fn());
 const snapshot={protocolVersion:2,anchorId:'a',body:'正文',bodyOoxml:'original',paragraphs:[],location:{paragraphIndex:0,before:'',after:'正文',section:'第一节'}};
 const request=vi.fn(async(_id:string,method:string)=>['read','capture'].includes(method)?snapshot:{ok:true});
 const bridge={select:()=> 'session',request} as unknown as WordBridge;
 const focus={appName:'Word',bundleId:'com.microsoft.Word'};
 try{
  await agent.beginWordPaste(focus,bridge);await (agent.files as any).chain;
  await agent.control('cancel');expect(store.list()).toHaveLength(1);
  expect(request.mock.calls.some(c=>c[1]==='release')).toBe(true);
  snapshot.location.section='第三节';await agent.beginWordPaste(focus,bridge);await (agent.files as any).chain;
  expect(agent.status()).toMatchObject({targetLocation:'第三节 · 正文第 1 段',phase:'ready'});
 }finally{await agent.shutdown();}
});
it('passes a native release identity to Office capture and freezes that returned range without running a write',async()=>{
 root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-word-drop-'));const store=new ClipboardStore(path.join(root,'clipboard'));store.add({type:'text',body:{text:'合成资料'}});
 const scenes={phase:'ready',status:()=>({phase:'ready'}),ensurePlanned(){},async shutdown(){}} as unknown as SceneRunner;
 const agent=new DesktopAgent(root,scenes,store,vi.fn());
 const snapshot={protocolVersion:2,anchorId:'drop-anchor',body:'正文',bodyOoxml:'original',paragraphs:[],location:{paragraphIndex:2,before:'前文',after:'后文',section:'三、计划'}};
 const request=vi.fn(async(_id:string,method:string)=>['read','capture'].includes(method)?snapshot:{ok:true});
 const bridge={select:()=> 'session',request} as unknown as WordBridge;
 const nativeDrop={id:crypto.randomUUID(),host:'word' as const,windowId:5,x:500,y:320,positioned:true,capturedAt:Date.now()};
 try{
  await agent.beginWordPaste({appName:'Word',bundleId:'com.microsoft.Word',nativeDrop},bridge);await (agent.files as any).chain;
  expect(request).toHaveBeenCalledWith('session','capture',{nativeDrop});
  expect(agent.status()).toMatchObject({phase:'ready',targetLocation:'三、计划 · 正文第 3 段'});
  expect(request.mock.calls.some(c=>['apply','insert'].includes(c[1]))).toBe(false);
 }finally{await agent.shutdown();}
});
it('releases a cancelled native capture even when the Office range arrives after cancellation',async()=>{
 root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-word-drop-late-'));const store=new ClipboardStore(path.join(root,'clipboard'));const source=store.add({type:'text',body:{text:'仍保留的合成资料'}});
 const scenes={phase:'ready',status:()=>({phase:'ready'}),ensurePlanned(){},async shutdown(){}} as unknown as SceneRunner;
 const agent=new DesktopAgent(root,scenes,store,vi.fn());
 let complete!:(value:any)=>void;const late=new Promise(resolve=>{complete=resolve;});
 const snapshot={protocolVersion:2,anchorId:'late-anchor',body:'正文',bodyOoxml:'original',paragraphs:[],location:{paragraphIndex:0,before:'',after:'正文',section:''}};
 const request=vi.fn(async(_id:string,method:string)=>method==='capture'?late:method==='read'?snapshot:{ok:true});
 const bridge={select:()=> 'session',request} as unknown as WordBridge;
 const nativeDrop={id:crypto.randomUUID(),host:'word' as const,windowId:5,x:500,y:320,positioned:true,capturedAt:Date.now()};
 try{
  const pending=agent.beginWordPaste({appName:'Word',bundleId:'com.microsoft.Word',nativeDrop},bridge);
  await vi.waitFor(()=>expect(request).toHaveBeenCalledWith('session','capture',{nativeDrop}));
  expect(agent.run({itemIds:[source.id],actionIndex:0,instruction:'不得提前执行'}).ok).toBe(false);
  expect((await agent.preparePackDrag()).ok).toBe(false);
  expect(await agent.cancelNativeDrop(nativeDrop.id)).toEqual({ok:true});
  const cancelled=expect(pending).rejects.toThrow('已取消');complete(snapshot);await cancelled;
  expect(request).toHaveBeenCalledWith('session','release',{anchorId:'late-anchor'});
  expect(store.list().map(item=>item.id)).toEqual([source.id]);expect(agent.status().anchor).toBeUndefined();
 }finally{await agent.shutdown();}
});
