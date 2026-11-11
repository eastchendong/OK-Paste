import fs from 'node:fs';
import vm from 'node:vm';
import {describe,it,expect,vi} from 'vitest';

function setup(){
 let serial=0;const commitUndo=vi.fn();
 function node(type:string,name:string,parent:any=null){
  const value:any={id:`node-${++serial}`,type,name,parent,removed:false,children:[],x:0,y:0,width:300,height:300,fills:[],layoutMode:'NONE',visible:true,locked:false};
  value.appendChild=(child:any)=>{if(child.parent)child.parent.children=child.parent.children.filter((n:any)=>n!==child);child.parent=value;value.children.push(child);};
  value.insertChild=(index:number,child:any)=>{if(child.parent)child.parent.children=child.parent.children.filter((n:any)=>n!==child);child.parent=value;value.children.splice(index,0,child);};
  value.remove=()=>{value.parent.children=value.parent.children.filter((n:any)=>n!==value);value.removed=true;};
  value.rescale=(scale:number)=>{value.width*=scale;value.height*=scale;};
  value.resize=(width:number,height:number)=>{value.width=width;value.height=height;};
  value.exportAsync=async()=>new Uint8Array([1,2,3]);value.loadAsync=async()=>{};
  value.clone=()=>{function copy(source:any,parent:any):any{const next=node(source.type,source.name,parent);for(const key of ['x','y','width','height','fills','layoutMode'])next[key]=structuredClone(source[key]);for(const child of source.children)copy(child,next);return next;}return copy(value,value.parent);};
  if(parent)parent.appendChild(value);return value;
 }
 const root=node('DOCUMENT','合成角色测试'),page=node('PAGE','角色',root),reference=node('FRAME','原有角色',page),original=node('VECTOR','保留原图',reference),target=node('FRAME','新角色',page);
 page.selection=[target];
 const events=new Map();
 const figma:any={root,currentPage:page,commitUndo,on:(name:string,callback:any)=>events.set(name,callback),base64Encode:(b:Uint8Array)=>Buffer.from(b).toString('base64'),createNodeFromSvg:vi.fn(()=>{const frame=node('FRAME','导入结果',figma.currentPage);node('VECTOR','可编辑曲线',frame);return frame;})};
 figma.createFrame=()=>node('FRAME','Frame',figma.currentPage);figma.viewport={scrollAndZoomIntoView:vi.fn()};
 const context=vm.createContext({setTimeout});vm.runInContext(fs.readFileSync(new URL('../figma-live/host.js',import.meta.url),'utf8'),context);
 vm.runInContext(fs.readFileSync(new URL('../figma-live/fixture.js',import.meta.url),'utf8'),context);
 const dispatch=context.createTuotieFigmaHost(figma);
 const apply=(snapshot:any,replaceResultId='',expectedRevision=replaceResultId?1:0)=>dispatch('apply',{anchorId:snapshot.anchorId,expectedVersion:snapshot.version,expectedRevision,taskId:crypto.randomUUID(),summary:'新角色',svg:'<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L20 20"/></svg>',replaceResultId});
 return {dispatch,figma,root,page,reference,original,target,node,apply,drop:(id:string,hit:any)=>events.get('drop')({node:hit,files:[{name:`pack-${id}.okpaste`}],absoluteX:10,absoluteY:20}),fixture:()=>context.createTuotieFigmaRevisionFixture(figma)};
}
describe('Figma document boundary',()=>{
 it('resolves the newly hit child to its top-level drop frame and refuses blank or protected targets',async()=>{
  const s=setup(),child=s.node('RECTANGLE','落点图层',s.reference),nativeDrop={id:crypto.randomUUID(),host:'figma',positioned:true};
  expect(s.drop(nativeDrop.id,child)).toBe(false);
  s.page.selection=[s.target]; // Deliberately unrelated old selection.
  const snapshot=await s.dispatch('capture',{nativeDrop});
  expect(snapshot.target.nodeId).toBe(s.reference.id);expect(s.figma.createNodeFromSvg).not.toHaveBeenCalled();
  expect(s.page.selection).toEqual([s.target]);
  s.drop(nativeDrop.id,s.page);await expect(s.dispatch('capture',{nativeDrop})).rejects.toThrow('顶层画框');
  s.drop(nativeDrop.id,child);s.reference.locked=true;await expect(s.dispatch('capture',{nativeDrop})).rejects.toThrow('未锁定');
  s.drop(nativeDrop.id,child);s.reference.locked=false;s.reference.layoutMode='HORIZONTAL';await expect(s.dispatch('capture',{nativeDrop})).rejects.toThrow('自动布局');
  await expect(s.dispatch('capture',{nativeDrop:{...nativeDrop,positioned:false}})).rejects.toThrow('实际落点');
 });
 it('captures the selected frame and current-page context, then writes to that saved frame after selection/page changes',async()=>{
  const s=setup(),snapshot=await s.dispatch('capture');
  expect(snapshot.document.scope).toBe('current-page');expect(snapshot.previews.map((p:any)=>p.nodeId)).toEqual([s.target.id,s.reference.id]);
  s.page.selection=[s.reference];s.figma.currentPage=s.node('PAGE','另一个页面',s.root);
  const result=await s.apply(snapshot);expect(s.target.children).toHaveLength(1);expect(s.target.children[0].children[0].type).toBe('VECTOR');expect(s.reference.children[0]).toBe(s.original);
  await s.dispatch('undo',{anchorId:snapshot.anchorId,resultId:result.resultId,expectedRevision:1});expect(s.target.children).toHaveLength(0);expect(s.reference.children[0]).toBe(s.original);
 });
 it('rejects multiple, locked, nested and auto-layout target frames',async()=>{
  const s=setup();s.page.selection=[s.target,s.reference];await expect(s.dispatch('capture')).rejects.toThrow('一个');
  s.page.selection=[s.target];s.target.locked=true;await expect(s.dispatch('capture')).rejects.toThrow('未锁定');
  s.target.locked=false;s.target.layoutMode='HORIZONTAL';await expect(s.dispatch('capture')).rejects.toThrow('自动布局');
  s.target.layoutMode='NONE';s.reference.appendChild(s.target);await expect(s.dispatch('capture')).rejects.toThrow('顶层');
 });
 it('rejects a changed document before importing anything',async()=>{
  const s=setup(),snapshot=await s.dispatch('capture');s.original.fills=[{type:'SOLID',color:{r:1,g:0,b:0}}];
  await expect(s.apply(snapshot)).rejects.toThrow('页面已改变');expect(s.figma.createNodeFromSvg).not.toHaveBeenCalled();
 });
 it('keeps the previous result if the next import fails, and protects manual edits inside results',async()=>{
  const s=setup(),snapshot=await s.dispatch('capture'),result=await s.apply(snapshot),old=s.target.children[0];
  const updated=await s.dispatch('read',{anchorId:snapshot.anchorId});s.figma.createNodeFromSvg.mockImplementationOnce(()=>{throw new Error('SVG import failed');});
  await expect(s.apply(updated,result.resultId)).rejects.toThrow('SVG import failed');expect(old.removed).toBe(false);
  old.children[0].name='用户修改';await expect(s.dispatch('undo',{anchorId:snapshot.anchorId,resultId:result.resultId,expectedRevision:1})).rejects.toMatchObject({mutationStarted:false,message:expect.stringContaining('手动修改')});expect(old.removed).toBe(false);
 });
 it('removes only owned output, leaving separately added user objects intact',async()=>{
  const s=setup(),snapshot=await s.dispatch('capture'),result=await s.apply(snapshot),manual=s.node('VECTOR','手动添加',s.target);
  await s.dispatch('undo',{anchorId:snapshot.anchorId,resultId:result.resultId,expectedRevision:1});expect(s.target.children).toEqual([manual]);
 });
 it('deduplicates a consumed write and refuses executable or external SVG content',async()=>{
  const s=setup(),snapshot=await s.dispatch('capture'),result=await s.apply(snapshot);
  expect(await s.dispatch('apply',{anchorId:snapshot.anchorId,taskId:result.resultId})).toEqual(result);expect(s.figma.createNodeFromSvg).toHaveBeenCalledTimes(1);
  const updated=await s.dispatch('read',{anchorId:snapshot.anchorId});await expect(s.dispatch('apply',{anchorId:snapshot.anchorId,expectedVersion:updated.version,expectedRevision:1,replaceResultId:result.resultId,taskId:crypto.randomUUID(),svg:'<svg ><image href="https://example.org/image.png"/></svg>'})).rejects.toThrow('矢量内容无效');
  await expect(s.dispatch('executeJavaScript',{code:'anything'})).rejects.toThrow('不支持');
 });
 it('renders a temporary frame without changing original nodes, including cleanup on export failure',async()=>{
  const s=setup(),before=await s.dispatch('capture'),first=await s.apply(before),snapshot=await s.dispatch('read',{anchorId:before.anchorId});
  const preview=await s.dispatch('preview',{anchorId:before.anchorId,expectedVersion:snapshot.version,svg:'<svg xmlns="http://www.w3.org/2000/svg"></svg>',summary:'候选'});
  expect(preview.image).toBe('data:image/png;base64,AQID');
  expect((await s.dispatch('read',{anchorId:before.anchorId})).version).toBe(snapshot.version);expect(s.target.children).toHaveLength(1);
  const clone=s.target.clone;s.target.clone=()=>{const value=clone();value.exportAsync=async()=>{throw new Error('export failed');};return value;};
  await expect(s.dispatch('preview',{anchorId:before.anchorId,expectedVersion:snapshot.version,svg:'<svg ></svg>'})).rejects.toMatchObject({mutationStarted:false});
  expect((await s.dispatch('read',{anchorId:before.anchorId})).version).toBe(snapshot.version);
  await s.dispatch('undo',{anchorId:before.anchorId,resultId:first.resultId,expectedRevision:1});
 });
 it('restores V2 → V1 → V0 and preserves user siblings and stacking order',async()=>{
  const s=setup(),before=await s.dispatch('capture'),first=await s.apply(before),originalPlacement={x:s.target.children[0].x,y:s.target.children[0].y,width:s.target.children[0].width};
  const manual=s.node('VECTOR','手动对象',s.target),updated=await s.dispatch('read',{anchorId:before.anchorId}),second=await s.apply(updated,first.resultId);
  expect(s.target.children[1]).toBe(manual);
  const restored=await s.dispatch('undo',{anchorId:before.anchorId,resultId:second.resultId,expectedRevision:2});
  expect(restored).toMatchObject({revision:1,resultId:first.resultId});expect(s.target.children[0]).toMatchObject(originalPlacement);expect(s.target.children[1]).toBe(manual);
  await expect(s.dispatch('undo',{anchorId:before.anchorId,resultId:second.resultId,expectedRevision:2})).rejects.toMatchObject({mutationStarted:false});
  await s.dispatch('undo',{anchorId:before.anchorId,resultId:first.resultId,expectedRevision:1});expect(s.target.children).toEqual([manual]);
  manual.remove();expect((await s.dispatch('read',{anchorId:before.anchorId})).version).toBe(before.version);
  await expect(s.dispatch('apply',{anchorId:before.anchorId,taskId:second.resultId})).rejects.toThrow('不能重复');
 });
 it('reuses the exact initial scale instead of deriving it from a rounded host width',async()=>{
  const s=setup(),original=s.figma.createNodeFromSvg.getMockImplementation(),scales:number[]=[];
  s.target.width=466;s.target.height=678;
  s.figma.createNodeFromSvg.mockImplementation((svg:string)=>{const value=original(svg),rescale=value.rescale;value.rescale=(scale:number)=>{scales.push(scale);rescale(scale);value.width=Math.fround(value.width);value.height=Math.fround(value.height);};return value;});
  const before=await s.dispatch('capture'),first=await s.apply(before),updated=await s.dispatch('read',{anchorId:before.anchorId}),second=await s.apply(updated,first.resultId);
  await s.dispatch('undo',{anchorId:before.anchorId,resultId:second.resultId,expectedRevision:2});expect(scales[2]).toBe(scales[0]);
 });
 it('keeps V2 when rebuilding an earlier version fails',async()=>{
  const s=setup(),before=await s.dispatch('capture'),first=await s.apply(before),next=await s.dispatch('read',{anchorId:before.anchorId}),second=await s.apply(next,first.resultId),node=s.target.children[0];
  s.figma.createNodeFromSvg.mockImplementationOnce(()=>{throw new Error('cannot restore');});
  await expect(s.dispatch('undo',{anchorId:before.anchorId,resultId:second.resultId,expectedRevision:2})).rejects.toMatchObject({mutationStarted:false});expect(node.removed).toBe(false);
 });
 it('only creates a revision fixture in the named synthetic file and never clears an occupied frame',async()=>{
  const s=setup();await expect(s.fixture()).rejects.toThrow('独立');expect(s.page.children).toHaveLength(2);
  s.root.name='妥帖 · Figma 矢量测试 · 1030';s.page.name='妥帖 · 同系列角色测试';await s.fixture();const frame=s.page.selection[0];
  expect(frame.name).toBe('04 · 修订验收');expect(frame.children).toHaveLength(0);expect(s.reference.children[0]).toBe(s.original);
  await s.fixture();expect(s.page.selection[0]).toBe(frame);s.node('VECTOR','已有结果',frame);
  await expect(s.fixture()).rejects.toThrow('未清理或覆盖');expect(frame.children).toHaveLength(1);
 });
});
