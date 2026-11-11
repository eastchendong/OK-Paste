import {afterEach,describe,expect,it} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';
import {FigmaClient} from '../src/figma/client';import {FigmaBridge,figmaConnection} from '../src/figma/bridge';
import {FigmaTarget} from '../src/targets/figma';import {ClipboardStore} from '../src/clipboard/store';import {destinationForApp} from '../src/app-context';
const cleanup:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{for(const run of cleanup.splice(0).reverse())await run();});
function directory(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-figma-'));cleanup.push(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}

// Executes the shipped plugin code against an in-memory Plugin API fixture.
// This verifies transport/scope/transactions; it is not Figma native acceptance.
function plugin(){
 let sequence=0;const nodes=new Map<string,any>();
 class Node {
  id=String(++sequence)+':1';name='node';type='FRAME';parent:any=null;children:Node[]=[];x=0;y=0;width=320;height=180;fills:any[]=[];removed=false;
  constructor(){nodes.set(this.id,this);}
  get absoluteTransform(){return [[1,0,this.x],[0,1,this.y]];}
  appendChild(child:Node){if(child.parent)child.parent.children=child.parent.children.filter((node:Node)=>node!==child);this.children.push(child);child.parent=this;}
  resize(width:number,height:number){this.width=width;this.height=height;}
  clone(){const copy=new Node();Object.assign(copy,{name:this.name,type:this.type,x:this.x,y:this.y,width:this.width,height:this.height,fills:structuredClone(this.fills)});if('characters' in this)Object.assign(copy,{characters:(this as any).characters,getStyledTextSegments:()=>[{fontName:{family:'Inter',style:'Regular'}}]});for(const child of this.children)copy.appendChild(child.clone());this.parent?.appendChild(copy);return copy;}
  remove(){this.removed=true;if(this.parent)this.parent.children=this.parent.children.filter((node:Node)=>node!==this);nodes.delete(this.id);}
  async exportAsync(){return Buffer.from('synthetic-png-contract-fixture');}
 }
 const page:any=new Node();page.type='PAGE';page.name='Test page';const original=new Node();original.name='Original';page.appendChild(original);page.selection=[original];
 const document={name:'Synthetic design'};
 const figma:any={fileKey:'test-file',root:document,currentPage:page,ui:{},viewport:{center:{x:100,y:100},scrollAndZoomIntoView(){}},showUI(){},getNodeByIdAsync:async(id:string)=>nodes.get(id),setCurrentPageAsync:async(p:any)=>{figma.currentPage=p;},
  listAvailableFontsAsync:async()=>[{fontName:{family:'Inter',style:'Regular'}}],loadFontAsync:async()=>{},
  createFrame:()=>{const node=new Node();page.appendChild(node);return node;},createRectangle:()=>{const node=new Node();node.type='RECTANGLE';page.appendChild(node);return node;},
  createText:()=>{const node:any=new Node();node.type='TEXT';node.characters='';node.getStyledTextSegments=()=>[{fontName:{family:'Inter',style:'Regular'}}];page.appendChild(node);return node;},
  createImage:()=>({hash:'fixture-image'}),base64Decode:(s:string)=>Buffer.from(s,'base64'),base64Encode:(bytes:Uint8Array)=>Buffer.from(bytes).toString('base64')};
 vm.runInNewContext(fs.readFileSync(path.join(process.cwd(),'figma/plugin/code.js'),'utf8'),{figma,__html__:''});
 async function invoke(name:string,args:Record<string,unknown>={},kind='command'){let response:any;figma.ui.postMessage=(value:any)=>{response=value;};await figma.ui.onmessage({id:'test',kind,name,args});if(response.error)throw new Error(response.error);return JSON.parse(JSON.stringify(response.result));}
 return {figma,page,original,invoke};
}
describe('Figma MCP adapter',()=>{
 it('starts without crypto.randomUUID and accepts Figma sandbox relayed replies',async()=>{
  const script=fs.readFileSync('figma/plugin/ui.html','utf8').split('<script>')[1].split('</script>')[0].replace('__TUOTIE_TOKEN__','"fixture-token"');
  const messages:any[]=[],requests:string[]=[];const parent={postMessage:(value:any)=>messages.push(value)},window:any={};
  expect(()=>vm.runInNewContext(script,{crypto:{},window,parent,setTimeout:()=>0,clearTimeout(){},document:{getElementById:()=>({textContent:''})},fetch:async(url:string)=>{requests.push(url);return {ok:true,json:async()=>({commands:[]})};}})).not.toThrow();
  expect(messages[0].pluginMessage.kind).toBe('snapshot');
  window.onmessage({source:{},data:{pluginMessage:{id:'1',result:{documentName:'fixture'}}}});
  await new Promise(resolve=>setImmediate(resolve));expect(requests).toEqual(['http://localhost:47723/snapshot','http://localhost:47723/commands']);
 });
 it('uses the shipped Plugin API operations on an isolated editable copy and rejects edits outside it',async()=>{
  const p=plugin();const before=p.original.name;
  const preview=await p.invoke('figma_begin_preview');
  const structure=await p.invoke('figma_inspect_preview');const copyId=structure.nodes.children[0].id;
  expect(copyId).not.toBe(p.original.id);await p.invoke('figma_set_fill',{nodeId:copyId,color:'#0000ff'});
  await expect(p.invoke('figma_set_fill',{nodeId:p.original.id,color:'#ff0000'})).rejects.toThrow('只能编辑本次预览');
  const text=await p.invoke('figma_create_text',{text:'Hello',x:20,y:30,width:200,fontSize:18,color:'#283348'});
  await p.invoke('figma_set_text',{nodeId:text.id,text:'Updated'});
  expect((await p.invoke('figma_preview_status')).changed).toBe(true);
  // The original's parent gains the preview, but its own design stays identical.
  expect(p.original.fills).toEqual([]);expect(p.original.children).toHaveLength(0);expect(before).toBe('Original');
  const applied=await p.invoke('figma_commit_preview');expect(applied.id).toBe(preview.id);expect(p.page.children).toHaveLength(2);
  expect(await p.invoke('figma_commit_preview')).toEqual(applied);await p.invoke('figma_undo');expect(p.page.children).toEqual([p.original]);
 });
 it('cancels only preview and refuses undo after a user edits the result',async()=>{
  const p=plugin();await p.invoke('figma_begin_preview');await p.invoke('figma_cancel_preview');expect(p.page.children).toEqual([p.original]);
  await p.invoke('figma_begin_preview');await p.invoke('figma_set_fill',{color:'#ffffff'}).catch(()=>{});
  await p.invoke('figma_create_rectangle',{name:'Box',x:0,y:0,width:20,height:30,color:'#ffffff'});
  await p.invoke('figma_commit_preview');p.page.selection[0].x+=10;
  await expect(p.invoke('figma_undo')).rejects.toThrow('已被继续编辑');expect(p.page.children).toHaveLength(2);
 });
 it('loads an available Chinese font for Chinese text instead of an Inter-only face',async()=>{
  const p=plugin();p.figma.listAvailableFontsAsync=async()=>[{fontName:{family:'Inter',style:'Regular'}},{fontName:{family:'Noto Sans SC',style:'Regular'}}];
  await p.invoke('figma_begin_preview');const text=await p.invoke('figma_create_text',{text:'妥帖已连接',x:0,y:0,width:200,fontSize:24,color:'#000000'});
  expect((await p.figma.getNodeByIdAsync(text.id)).fontName).toEqual({family:'Noto Sans SC',style:'Regular'});await p.invoke('figma_cancel_preview');
 });
 it('rejects unauthenticated plugin calls and a second active file',async()=>{
  const bridge=new FigmaBridge('test-token');const port=await bridge.start(0);cleanup.push(()=>bridge.close());const url=`http://127.0.0.1:${port}`;
  expect((await fetch(url+'/commands')).status).toBe(403);
  const headers={'X-Tuotie-Token':'test-token','Content-Type':'application/json'};
  expect((await fetch(url+'/snapshot',{method:'POST',headers,body:JSON.stringify({session:'one',context:{pageId:'p1'}})})).status).toBe(200);
  expect((await fetch(url+'/snapshot',{method:'POST',headers,body:JSON.stringify({session:'two',context:{pageId:'p2'}})})).status).toBe(409);
  expect(bridge.status()).toMatchObject({connected:true,pageId:'p1'});
 });
 it('runs actual stdio MCP discovery, plugin HTTP round trips and target preview/commit/undo',async()=>{
  const root=directory();for(const folder of ['scripts','src/figma']){fs.mkdirSync(path.join(root,folder),{recursive:true});}
  fs.copyFileSync('scripts/figma-mcp.ts',path.join(root,'scripts/figma-mcp.ts'));fs.cpSync('src/figma',path.join(root,'src/figma'),{recursive:true});
  fs.symlinkSync(path.join(process.cwd(),'node_modules'),path.join(root,'node_modules'),'dir');fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
  const reservation=new FigmaBridge('reserve');const port=await reservation.start(0);await reservation.close();
  const client=new FigmaClient(root,port);cleanup.push(()=>client.close());await client.connect();expect(client.context.connected).toBe(false);
  const p=plugin(),token=figmaConnection(root).token,headers={'X-Tuotie-Token':token,'Content-Type':'application/json'};
  let running=true;const endpoint=`http://127.0.0.1:${port}`;
  const pump=(async()=>{while(running){
   await fetch(endpoint+'/snapshot',{method:'POST',headers,body:JSON.stringify({session:'integration',context:await p.invoke('',{},'snapshot')})});
   const response=await fetch(endpoint+'/commands',{headers});const {commands}=await response.json() as any;
   for(const command of commands){let result:any;try{result={result:await p.invoke(command.name,command.args)};}catch(error){result={error:String(error)};}await fetch(endpoint+'/result',{method:'POST',headers,body:JSON.stringify({id:command.id,...result})});}
   await new Promise(resolve=>setTimeout(resolve,15));
  }})();cleanup.push(async()=>{running=false;await pump;});
  const store=new ClipboardStore(path.join(root,'.local/clipboard'));const target=new FigmaTarget(root,{appName:'Figma',bundleId:'com.figma.Desktop'},store,client);
  await new Promise(resolve=>setTimeout(resolve,80));const context=await target.read();expect(context).toMatchObject({connected:true,pageName:'Test page'});
  // Optional tools remain usable directly; desktop focus no longer starts MCP.
  expect(destinationForApp(target.focus)).toBe('focused');expect(target.tools().map(tool=>tool.name)).toContain('figma_set_text');
  await target.begin();await expect(target.invoke('figma_set_fill',{nodeId:p.original.id,color:'#ff0000'})).rejects.toThrow('只能编辑');
  await target.invoke('figma_create_text',{text:'MCP result',x:10,y:20,width:200,fontSize:18,color:'#000000'});await target.read();
  expect(target.previewChanged).toBe(true);expect(fs.readFileSync(target.previewPath,'utf8')).toBe('synthetic-png-contract-fixture');expect(target.canUndo).toBe(false);
  await target.commit();expect(target.canUndo).toBe(true);expect(p.page.children).toHaveLength(2);await target.undo();expect(p.page.children).toEqual([p.original]);
 },30000);
});
