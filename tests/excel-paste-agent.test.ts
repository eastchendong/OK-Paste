import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {DesktopAgent} from '../src/desktop-agent';import {ClipboardStore} from '../src/clipboard/store';
import type {SceneRunner} from '../src/scene-runner';import type {OfficeBridge} from '../src/office-live/bridge';
vi.mock('../src/agent-client',()=>({AgentClient:class {
 async planTarget(){return {title:'更新数据',summary:'结合资料更新选区',actions:['更新'],questions:[],needsClarification:false,suggestions:['补全同比公式','按资料更新数值','统一空值标记']};}
 async executeTarget(input:any){await input.invoke('prepare_excel_update',{cells:[[10,20],[30,40]]});return {summary:'已准备选区预览',calls:[]};}
}}));
let root='';afterEach(()=>{if(root)fs.rmSync(root,{recursive:true,force:true});});
it('pins the selected workbook range, writes the generated result immediately, keeps undo, and releases on finish',async()=>{
 root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-excel-agent-'));const store=new ClipboardStore(path.join(root,'clipboard'));
 const source=store.add({type:'text',body:{text:'合成季度数据'}});
 const scenes={phase:'ready',status:()=>({phase:'ready'}),ensurePlanned(){},async shutdown(){},async control(){return {ok:true};}} as unknown as SceneRunner;
 const agent=new DesktopAgent(root,scenes,store,vi.fn());
 const range={address:'数据!B2:C3',rowCount:2,columnCount:2,formulas:[[1,2],[3,4]],text:[['1','2'],['3','4']],numberFormat:[['0','0'],['0','0']]};
 const snapshot={protocolVersion:2,anchorId:'a',version:'v1',worksheet:'数据',selection:range,workbook:{name:'测试.xlsx',sheets:[{name:'数据',usedRange:range}]}};
 const request=vi.fn(async(_id:string,method:string)=>['read','capture'].includes(method)?snapshot:{ok:true});
 const bridge={select:()=> 'session',request} as unknown as OfficeBridge;
 try{
  await agent.beginExcelPaste({appName:'Excel',bundleId:'com.microsoft.Excel',windowTitle:'测试.xlsx'},bridge);await (agent.files as any).chain;
  expect(agent.status()).toMatchObject({targetKind:'excel-live',phase:'ready',targetName:'数据 · B2:C3',actions:['补全同比公式']});
  await agent.updateFocus({appName:'其他应用',bundleId:'com.example.other'});
  expect(agent.status()).toMatchObject({targetKind:'excel-live',targetName:'数据 · B2:C3'});
  expect(agent.run({destinationId:'office',itemIds:[source.id],actionIndex:0}).ok).toBe(true);await (agent.files as any).chain;
  expect(agent.status()).toMatchObject({phase:'done',previewText:'10\t20\n30\t40',canUndo:true,taskArchived:false});
  expect(request.mock.calls.filter(call=>call[1]==='apply')).toHaveLength(1);expect(store.list()).toHaveLength(1);
  agent.ensurePlanned();expect(agent.status().phase).toBe('done');
  const later=store.add({type:'text',body:{text:'下一次任务的新资料'}});
  await agent.control('finish');await (agent.files as any).chain;
  expect(store.get(source.id)?.archivedAt).toBeTruthy();
  expect(store.list().map(item=>item.id)).toEqual([later.id]);
  expect(agent.status()).toMatchObject({targetKind:'focused-text',targetName:'其他应用'});
  expect(request.mock.calls.some(call=>call[1]==='release')).toBe(true);
 }finally{await agent.shutdown();}
});
