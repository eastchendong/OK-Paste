import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import type {OfficeBridge} from '../src/office-live/bridge';
const mock=vi.hoisted(()=>({legacyClient:vi.fn(),plan:vi.fn()}));
vi.mock('../src/figma/client',()=>({FigmaClient:class {constructor(){mock.legacyClient();throw new Error('Legacy MCP must not start from desktop focus');}}}));
vi.mock('../src/agent-client',()=>({AgentClient:class {
 async planTarget(input:unknown){mock.plan(input);return {title:'蓝色图形',summary:'结合参考和目标画框',actions:['生成'],suggestions:['生成蓝色图形'],questions:[],needsClarification:false};}
 async executeTarget(args:any){
  const candidate=await args.invoke('prepare_figma_artwork',{summary:'蓝色图形',artwork:{width:100,height:100,shapes:[{type:'rect',name:'卡片',group:'主体',x:10,y:10,width:80,height:80,rx:0,fill:'#0000ff',stroke:'none',strokeWidth:0,opacity:1}]}});
  await args.invoke('review_figma_artwork',{candidateId:candidate.candidateId,approved:true,issues:[]});
  return {summary:'已准备蓝色图形',calls:2};
 }
}}));
import {DesktopAgent} from '../src/desktop-agent';import {ClipboardStore} from '../src/clipboard/store';
const agents:DesktopAgent[]=[],roots:string[]=[];
afterEach(async()=>{for(const agent of agents.splice(0))await agent.shutdown();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});vi.clearAllMocks();});

it('uses only the captured Figma live host, pins it across app changes, and archives on finish',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-figma-agent-'));roots.push(root);
 const store=new ClipboardStore(path.join(root,'.local/clipboard')),source=store.add({type:'text',body:{text:'蓝色图形参考'}});
 const scenes:any={phase:'idle',status:()=>({phase:'idle'}),ensurePlanned:vi.fn(),shutdown:vi.fn()};
 const agent=new DesktopAgent(root,scenes,store,()=>{});agents.push(agent);
 const focus={appName:'Figma',bundleId:'com.figma.Desktop',windowTitle:'合成卡片'};
 await agent.updateFocus(focus);await (agent.files as any).chain;
 expect(mock.legacyClient).not.toHaveBeenCalled();
 const snapshot={protocolVersion:2,anchorId:'captured-frame',version:'v1',document:{name:'合成卡片',page:{id:'p',name:'Page'},pages:[],items:[],scope:'current-page'},target:{nodeId:'f',name:'目标画框',width:100,height:100},previews:[]};
 const request=vi.fn(async(_id:string,method:string)=>['capture','read'].includes(method)?snapshot:method==='preview'?{image:'data:image/png;base64,AQID'}:method==='apply'?{resultId:'owned-result'}:{ok:true});
 const select=vi.fn(()=> 'live-session'),bridge={select,request}as unknown as OfficeBridge;
 await agent.beginFigmaPaste(focus,bridge);await (agent.files as any).chain;
 expect(select).toHaveBeenCalledWith(focus,'figma');
 expect(agent.status()).toMatchObject({destinationId:'office',targetKind:'figma-live',phase:'ready'});
 await agent.updateFocus({appName:'剪映',bundleId:'com.lemon.lvpro'});
 expect(agent.status().targetKind).toBe('figma-live');
 expect(agent.run({destinationId:'office',itemIds:[source.id],actionIndex:0}).ok).toBe(true);await (agent.files as any).chain;
 expect(request).toHaveBeenCalledWith('live-session','apply',expect.objectContaining({anchorId:'captured-frame',svg:expect.stringContaining('<rect')}));
 expect(agent.status()).toMatchObject({phase:'done',revision:1,canUndo:true});expect(store.list()).toHaveLength(1);
 const next=store.add({type:'text',body:{text:'留给下次'}});
 await agent.control('finish');
 expect(store.list().map(item=>item.id)).toEqual([next.id]);expect(store.get(source.id)?.archivedAt).toBeTruthy();
 expect(agent.status()).toMatchObject({destinationId:'disabled',targetKind:'disabled'});
 expect(mock.legacyClient).not.toHaveBeenCalled();expect(scenes.ensurePlanned).not.toHaveBeenCalled();
});
