import {afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ClipboardStore} from '../src/clipboard/store';
import {DesktopAgent} from '../src/desktop-agent';
import type {SceneRunner} from '../src/scene-runner';
import type {OfficeBridge} from '../src/office-live/bridge';
const model=vi.hoisted(()=>({planTarget:vi.fn(),executeTarget:vi.fn()}));
vi.mock('../src/agent-client',()=>({AgentClient:class{planTarget=model.planTarget;executeTarget=model.executeTarget;}}));
const root=process.cwd(),python=path.join(root,'.local/office-venv/bin/python');
const available=fs.existsSync(python);
const directories:string[]=[];
beforeAll(()=>{
 if(!available)return;
 const result=spawnSync(python,['scripts/office-fixtures.py','.local/office-check-fixtures'],{cwd:root,encoding:'utf8'});
 if(result.status!==0)throw new Error(result.stderr);
});
afterEach(()=>{directories.splice(0).forEach(dir=>fs.rmSync(dir,{recursive:true,force:true}));vi.clearAllMocks();});
function setup(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-target-'));directories.push(directory);
 const store=new ClipboardStore(path.join(directory,'clipboard'));
 const source=store.add({type:'text',body:{text:'研究笔记'}});
 const scenes={updateFocusContext:vi.fn(),phase:'ready',status:()=>({phase:'ready',actions:['三维场景方向']}),control:vi.fn(async()=>({ok:true})),ensurePlanned:vi.fn(),run:vi.fn(()=>({ok:true})),supplement:vi.fn(),dismissDrop:vi.fn(),shutdown:vi.fn(async()=>{})} as unknown as SceneRunner;
 const copyPreparedText=vi.fn();const agent=new DesktopAgent(directory,scenes,store,copyPreparedText);
 if(available){
  fs.mkdirSync(path.join(directory,'office'),{recursive:true});fs.copyFileSync(path.join(root,'office/files.py'),path.join(directory,'office/files.py'));
  fs.mkdirSync(path.join(directory,'.local'),{recursive:true});fs.symlinkSync(path.dirname(path.dirname(python)),path.join(directory,'.local/office-venv'),'dir');
  fs.copyFileSync(path.join(root,'.local/office-check-fixtures/research.docx'),path.join(directory,'research.docx'));
 }
 model.planTarget.mockResolvedValue({title:'补充研究发现',summary:'在文末补充一段',actions:['补充一段'],suggestions:['补充研究发现'],questions:[],needsClarification:false});
 model.executeTarget.mockImplementation(async args=>{await args.invoke('edit_target',{operations:[{type:'insert_paragraph',text:'新增研究发现'}]});return {summary:'副本已补充',calls:1};});
 return {agent,scenes,directory,source,store,copyPreparedText};
}
describe('one desktop target',()=>{
 for(const bundleId of ['com.lemon.lvpro','com.lemon.lvoverseas'])it(`disables ${bundleId} without planning, mutating, or losing references, and resumes another app`,async()=>{
  const {agent,store,source,copyPreparedText}=setup();
  try{
   await agent.updateFocus({appName:'剪映',bundleId});agent.ensurePlanned();
   expect(agent.status()).toMatchObject({phase:'idle',destinationId:'disabled',targetKind:'disabled',actions:[],canUndo:false});
   expect(agent.status().unavailableReason).toContain('暂未启用');
   expect(model.planTarget).not.toHaveBeenCalled();expect(agent.files.selected).toBe(false);
   expect(agent.run({destinationId:'jianying',actionIndex:0})).toMatchObject({ok:false,error:expect.stringContaining('暂未启用')});
   expect((await agent.control('commit')).ok).toBe(false);
   expect((await agent.markAnchor({appName:'剪映',bundleId,editAnchor:{markedAt:'now'}})).ok).toBe(false);
   expect(store.list().map(item=>item.id)).toEqual([source.id]);expect(copyPreparedText).not.toHaveBeenCalled();
   model.executeTarget.mockImplementation(async args=>{await args.invoke('prepare_text',{text:'其他应用的真实待粘贴文字'});return {summary:'已准备',calls:1};});
   await agent.updateFocus({appName:'备忘录',bundleId:'com.apple.Notes'});await (agent.files as any).chain;
   expect(agent.run({destinationId:'focused',itemIds:[source.id],actionIndex:0}).ok).toBe(true);await (agent.files as any).chain;
   expect(await agent.control('commit')).toMatchObject({ok:true});
   expect(copyPreparedText).toHaveBeenCalledWith('其他应用的真实待粘贴文字');expect(store.list()).toHaveLength(0);
  }finally{await agent.shutdown();}
 });
 it('reports the acknowledged vector artifact instead of stale model delivery instructions',async()=>{
  const {agent,source}=setup();
  const snapshot={protocolVersion:2,anchorId:'frame',version:'v1',document:{name:'矢量测试',page:{id:'p',name:'角色'},pages:[],items:[],scope:'current-page'},target:{nodeId:'f',name:'新角色',width:300,height:300},previews:[]};
  const request=vi.fn(async(_session:string,method:string)=>['capture','read'].includes(method)?snapshot:method==='preview'?{image:'data:image/png;base64,AQID'}:method==='apply'?{resultId:'owned'}:{});
  model.planTarget.mockResolvedValue({title:'生成玻璃瓶角色',summary:'结合参考画框',actions:['生成玻璃瓶角色'],suggestions:['微笑角色','挥手角色','害羞角色'],questions:[],needsClarification:false});
  model.executeTarget.mockImplementation(async args=>{
   const candidate=await args.invoke('prepare_figma_artwork',{summary:'玻璃瓶角色，包含瓶身、表情与四肢。',artwork:{width:300,height:300,shapes:[{type:'ellipse',name:'主体',group:'瓶身',cx:150,cy:150,rx:70,ry:100,fill:'#a6dddd',stroke:'#123c48',strokeWidth:6,opacity:1}]}});
   await args.invoke('review_figma_artwork',{candidateId:candidate.candidateId,approved:true,issues:[]});
   return {summary:'尚未写入，请确认应用。',calls:1};
  });
  await agent.beginFigmaPaste({appName:'Figma',bundleId:'com.figma.Desktop',windowTitle:'矢量测试'},{select:()=> 'session',request}as unknown as OfficeBridge);
  await (agent.files as any).chain;
  expect(agent.run({destinationId:'office',itemIds:[source.id],actionIndex:0}).ok).toBe(true);await (agent.files as any).chain;
  expect(agent.status()).toMatchObject({phase:'done',canUndo:true,step:'已加入 Figma 目标画框',result:'玻璃瓶角色，包含瓶身、表情与四肢。'});
  expect(request).toHaveBeenCalledWith('session','apply',expect.objectContaining({anchorId:'frame',svg:expect.stringContaining('<ellipse')}));
  await agent.shutdown();
 });
 it('keeps raw clipboard destinations out of model execution',async()=>{
  const {agent,scenes}=setup();await agent.selectTarget({id:'hold'});
  expect(agent.status().actions).toEqual([]);expect(agent.run({destinationId:'hold',actionIndex:0}).ok).toBe(false);
  expect(scenes.run).not.toHaveBeenCalled();
  expect((await agent.control('commit')).ok).toBe(false);expect(agent.supplement('修改')).toMatchObject({ok:false});
  expect(scenes.control).not.toHaveBeenCalled();expect(scenes.supplement).not.toHaveBeenCalled();
 });
 it.skipIf(!available)('routes Office actions, rejects stale targets, and protects an active preview from a Blender drop',async()=>{
  const {agent,scenes,directory,source}=setup();
  await agent.selectTarget({id:'office',path:path.join(directory,'research.docx')});await (agent.files as any).chain;
  expect(agent.run({destinationId:'blender',actionIndex:0}).ok).toBe(false);
  expect(agent.run({destinationId:'office',itemIds:[source.id],actionIndex:0,instruction:'追加研究发现'}).ok).toBe(true);
  await (agent.files as any).chain;expect(agent.status().phase).toBe('preview');expect(scenes.run).not.toHaveBeenCalled();
  expect(scenes.onDrop!()).toBe(false);expect(agent.status().destinationId).toBe('office');
  await agent.control('cancel');expect(scenes.onDrop!()).toBe(true);expect(agent.status().destinationId).toBe('blender');
  await agent.shutdown();
 });
 it.skipIf(!available)('archives the completed bundle, preserving captures for the next task and retaining history on undo',async()=>{
  const {agent,directory,source,store}=setup();
  const unused=store.add({type:'text',body:{text:'本包中的另一份资料'}});
  await agent.selectTarget({id:'office',path:path.join(directory,'research.docx')});await (agent.files as any).chain;
  expect(agent.run({destinationId:'office',itemIds:[source.id],actionIndex:0}).ok).toBe(true);
  const next=store.add({type:'text',body:{text:'生成期间新复制，属于下一次'}});
  await (agent.files as any).chain;
  expect(store.list()).toHaveLength(3);expect(agent.status().phase).toBe('preview');
  await agent.control('commit');
  expect(agent.status()).toMatchObject({phase:'done',taskArchived:true});
  expect(store.list().map(item=>item.id)).toEqual([next.id]);
  expect(store.get(source.id)?.archivedAt).toBeTruthy();expect(store.get(unused.id)?.archivedAt).toBeTruthy();
  await agent.control('undo');await (agent.files as any).chain;
  expect(store.list().map(item=>item.id)).toEqual([next.id]);
  expect(store.list(true)).toHaveLength(3);await agent.shutdown();
 });
 it.skipIf(!available)('continues an applied Office task from archived sources and keeps its conversation',async()=>{
  const {agent,directory,source,store}=setup();
  await agent.selectTarget({id:'office',path:path.join(directory,'research.docx')});await (agent.files as any).chain;
  agent.run({destinationId:'office',itemIds:[source.id],actionIndex:0,instruction:'补充研究发现'});await (agent.files as any).chain;
  await agent.control('commit');expect(store.list()).toHaveLength(0);
  const next=store.add({type:'text',body:{text:'下次任务内容'}});agent.ensurePlanned();
  expect(agent.status().phase).toBe('done');
  expect(agent.run({destinationId:'office',itemIds:[source.id],actionIndex:0,instruction:'再加一个具体例子',continuation:true}).ok).toBe(true);
  await (agent.files as any).chain;
  const conversation=model.planTarget.mock.calls.at(-1)![0].conversation;
  expect(conversation.map((m:any)=>m.text)).toEqual(['补充研究发现','副本已补充','再加一个具体例子']);
  expect(store.list().map(item=>item.id)).toEqual([next.id]);
  await agent.control('commit');expect(store.list().map(item=>item.id)).toEqual([next.id]);
  await agent.control('finish');await (agent.files as any).chain;expect(agent.status().phase).toBe('ready');
  await agent.shutdown();
 });

 it('uses the full package and focused ChatGPT context, then archives only on confirmed clipboard output',async()=>{
  const {agent,scenes,store,source}=setup();const second=store.add({type:'text',body:{text:'第二份资料'}});
  model.planTarget.mockResolvedValue({title:'整理成提问',summary:'依据当前对话准备提问文本',actions:['整理成提问'],suggestions:['整理成提问'],questions:[],needsClarification:false});
  model.executeTarget.mockImplementation(async args=>{await args.invoke('prepare_text',{text:'请结合两份资料分析这个问题。'});return {summary:'已准备提问草稿。',calls:1};});
  const focus={appName:'ChatGPT',bundleId:'com.openai.chat',windowTitle:'设计研究',focusedText:'正在讨论研究方法'};
  await agent.updateFocus(focus);await (agent.files as any).chain;
  expect(agent.status()).toMatchObject({destinationId:'focused',targetName:'ChatGPT',phase:'ready'});
  const input=model.planTarget.mock.calls[0][0];expect(input.context.focus).toEqual(focus);expect(input.sources.map((x:any)=>x.id).sort()).toEqual([source.id,second.id].sort());
  expect(scenes.ensurePlanned).not.toHaveBeenCalled();
  expect(agent.run({destinationId:'blender',actionIndex:0}).ok).toBe(false);
  expect(agent.run({destinationId:'focused',itemIds:[source.id,second.id],actionIndex:0}).ok).toBe(true);await (agent.files as any).chain;
  expect(store.list()).toHaveLength(2);expect(agent.status()).toMatchObject({phase:'preview',previewText:'请结合两份资料分析这个问题。'});
  const next=store.add({type:'text',body:{text:'下次任务'}});
  const result=await agent.control('commit');expect(result).toMatchObject({ok:true,clipboardText:'请结合两份资料分析这个问题。'});
  expect(store.list().map(x=>x.id)).toEqual([next.id]);await agent.shutdown();
 });
 it('discards a late plan after the foreground app and the package change',async()=>{
  const {agent,store}=setup();let complete:(x:any)=>void=()=>{};
  model.planTarget.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
  await agent.updateFocus({appName:'ChatGPT',bundleId:'com.openai.chat'});
  await vi.waitFor(()=>expect(model.planTarget).toHaveBeenCalledTimes(1));
  const switching=agent.updateFocus({appName:'Safari',bundleId:'com.apple.Safari',windowTitle:'资料网页'});
  store.add({type:'text',body:{text:'新内容'}});
  complete({title:'过期 ChatGPT 建议',summary:'旧上下文',actions:['旧建议'],suggestions:['旧建议'],questions:[],needsClarification:false});
  await switching;await (agent.files as any).chain;
  expect(agent.status()).toMatchObject({targetName:'Safari',phase:'ready'});
  expect(agent.status().actions).not.toContain('旧建议');
  expect(model.planTarget.mock.calls.at(-1)![0].sources).toHaveLength(2);await agent.shutdown();
 });

});

describe('Start from here',()=>{
 it('marks an empty insertion point without copying or planning, then applies later sources to that target while browsing',async()=>{
  const {agent,store,source}=setup();store.archive([source.id]);
  const anchor={appName:'在线文档',bundleId:'com.google.Chrome',windowTitle:'研究提纲',role:'AXTextArea',selectedText:'',editAnchor:{markedAt:'2026-10-28T08:00:00Z',url:'https://docs.example/research',range:{location:42,length:0}}};
  expect(await agent.markAnchor(anchor)).toMatchObject({ok:true});
  expect(store.list()).toHaveLength(0);expect(model.planTarget).not.toHaveBeenCalled();
  await agent.updateFocus({appName:'Safari',bundleId:'com.apple.Safari',windowTitle:'参考文章'});
  const reference=store.add({type:'text',body:{text:'之后找到的参考资料'}});agent.ensurePlanned();await (agent.files as any).chain;
  expect(agent.status()).toMatchObject({targetName:'在线文档',anchor,foregroundFocus:{appName:'Safari'},phase:'ready'});
  const planned=model.planTarget.mock.calls.at(-1)![0];expect(planned.context.focus).toEqual(anchor);expect(planned.sources[0].id).toBe(reference.id);
  await agent.markAnchor(null);await (agent.files as any).chain;
  expect(agent.status()).toMatchObject({targetName:'Safari'});expect(agent.status().anchor).toBeUndefined();
  await agent.shutdown();
 });
});

it('keeps the preview and source bundle when confirmed system copying fails, and allows retry',async()=>{
 const {agent,store,source,copyPreparedText}=setup();
 model.executeTarget.mockImplementation(async args=>{await args.invoke('prepare_text',{text:'实际待粘贴内容'});return {summary:'草稿已准备',calls:1};});
 await agent.updateFocus({appName:'ChatGPT',bundleId:'com.openai.chat'});await (agent.files as any).chain;
 agent.run({destinationId:'focused',itemIds:[source.id],actionIndex:0});await (agent.files as any).chain;
 copyPreparedText.mockImplementationOnce(()=>{throw new Error('系统复制失败');});
 expect(await agent.control('commit')).toMatchObject({ok:false,error:'系统复制失败'});
 expect(agent.status()).toMatchObject({phase:'preview',previewText:'实际待粘贴内容'});expect(store.list()).toHaveLength(1);
 expect(await agent.control('commit')).toMatchObject({ok:true});expect(copyPreparedText).toHaveBeenLastCalledWith('实际待粘贴内容');expect(store.list()).toHaveLength(0);
 await agent.shutdown();
});

it('captures a Blender shortcut without dispatching execution and retains its pending target across foreground changes',async()=>{
 const {agent,scenes}=setup();
 let pending:any=null;
 (scenes as any).beginPaste=vi.fn(async()=>{pending={eventId:'shortcut-centre',summary:'三维视口中心'};return {ok:true};});
 (scenes as any).status=()=>({phase:'ready',actions:[],pendingDrop:pending});
 const focus={appName:'Blender',bundleId:'org.blenderfoundation.blender'};
 expect(await agent.beginBlenderPaste(focus)).toEqual({ok:true});
 expect((scenes as any).beginPaste).toHaveBeenCalledExactlyOnceWith(focus);
 expect(scenes.run).not.toHaveBeenCalled();
 await agent.updateFocus({appName:'浏览器',bundleId:'com.google.Chrome'});
 expect(agent.status()).toMatchObject({destinationId:'blender',pendingDrop:{eventId:'shortcut-centre'}});
 await expect(agent.beginBlenderPaste({appName:'浏览器',bundleId:'com.google.Chrome'})).rejects.toThrow('Blender');
});

function captureGate(){let resolve!:(value:{ok:boolean})=>void;const promise=new Promise<{ok:boolean}>(r=>{resolve=r;});return {promise,resolve};}
it('keeps the latest foreground during deferred Blender capture and returns to it after cancel',async()=>{
 const {agent,scenes}=setup(),gate=captureGate();
 (scenes as any).beginPaste=vi.fn(()=>gate.promise);
 const blender={appName:'Blender',bundleId:'org.blenderfoundation.blender'},safari={appName:'Safari',bundleId:'com.apple.Safari'};
 const capture=agent.beginBlenderPaste(blender);
 await vi.waitFor(()=>expect((scenes as any).beginPaste).toHaveBeenCalledOnce());
 expect(agent.status()).toMatchObject({phase:'planning',actions:[]});
 await agent.updateFocus(safari);expect(agent.run({actionIndex:0}).ok).toBe(false);
 gate.resolve({ok:true});await capture;
 expect(agent.status()).toMatchObject({destinationId:'blender',focus:blender,foregroundFocus:safari});
 await agent.control('cancel');await (agent.files as any).chain;
 expect(agent.status()).toMatchObject({destinationId:'focused',targetName:'Safari',foregroundFocus:safari});
});
it('explicit target changes cancel a deferred Blender capture and ignore its late success',async()=>{
 const {agent,scenes}=setup(),gate=captureGate();
 (scenes as any).beginPaste=vi.fn(()=>gate.promise);(scenes as any).cancelPasteCapture=vi.fn();
 const capture=agent.beginBlenderPaste({appName:'Blender',bundleId:'org.blenderfoundation.blender'}).catch(error=>error);
 await vi.waitFor(()=>expect((scenes as any).beginPaste).toHaveBeenCalledOnce());
 await agent.selectTarget({id:'hold'});expect((scenes as any).cancelPasteCapture).toHaveBeenCalledOnce();
 gate.resolve({ok:true});expect(await capture).toBeInstanceOf(Error);
 expect(agent.status()).toMatchObject({destinationId:'hold',phase:'idle'});
});
