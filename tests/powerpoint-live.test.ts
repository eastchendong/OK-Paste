import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {PowerPointLiveTarget,type PowerPointSnapshot} from '../src/targets/powerpoint-live';
import {ClipboardStore} from '../src/clipboard/store';

const root=process.cwd();
const python=process.env.OKPASTE_OFFICE_PYTHON||[path.join(root,'.local/office-venv/bin/python'),path.join(os.homedir(),'Library/Application Support/Tuotie/runtime/.local/office-venv/bin/python')].find(file=>fs.existsSync(file));
const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0))fs.rmSync(directory,{recursive:true,force:true});});
describe.skipIf(!python)('live PowerPoint snapshots and independent image previews',()=>{
 let fixture:string,meta:{file:string;preservedShapeId:string;imageShapeId:string;slotShapeId:string};
 beforeAll(()=>{
  fixture=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-ppt-fixture-'));
  meta=JSON.parse(execFileSync(python!,[path.join(root,'scripts/powerpoint-fixture.py'),fixture],{encoding:'utf8'}));
 });
 afterAll(()=>{if(fixture)fs.rmSync(fixture,{recursive:true,force:true});});
 function setup(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-ppt-live-'));directories.push(directory);
  fs.mkdirSync(path.join(directory,'office'));fs.copyFileSync(path.join(root,'office/presentation.py'),path.join(directory,'office/presentation.py'));
  fs.mkdirSync(path.join(directory,'.local'),{recursive:true});fs.symlinkSync(path.dirname(path.dirname(python!)),path.join(directory,'.local/office-venv'),'dir');
  const store=new ClipboardStore(path.join(directory,'clipboard'));
  const sources=['source-a','source-b'].map(name=>store.add({type:'image',body:{dataUrl:`data:image/png;base64,${fs.readFileSync(path.join(fixture,name+'.png')).toString('base64')}`}}));
  const snapshot:PowerPointSnapshot={protocolVersion:2,anchorId:'range-ppt',version:'page-v1',slideId:'256',slideIndex:0,slideIds:['256'],selectedShapeIds:[meta.imageShapeId,meta.slotShapeId],slideImage:'cGl4ZWxz',fileBase64:fs.readFileSync(meta.file).toString('base64'),shapes:[{id:meta.imageShapeId,name:'待替换图片',type:'Image',left:324,top:129.6,width:180,height:180,rotation:0,zOrderPosition:2},{id:meta.slotShapeId,name:'头像空位',type:'GeometricShape',left:590.4,top:129.6,width:180,height:180,rotation:0,zOrderPosition:3}]};
  const request=vi.fn(async(_id:string,method:string,_args?:unknown)=>['capture','read'].includes(method)?snapshot:{ok:true});
  const target=new PowerPointLiveTarget(directory,{request} as any,'session-ppt','测试演示文稿',snapshot,store);
  const args={replacements:[{shapeId:meta.imageShapeId,imageId:sources[0].id,fit:'cover'},{shapeId:meta.slotShapeId,imageId:sources[1].id,fit:'contain'}]};
  return {directory,store,snapshot,request,target,args};
 }
 it('reads all 25 slides and notes, preserves unrelated page bytes, prepares pictures without changing the live document',async()=>{
  const {target,args,request}=setup();const context=await target.read();
  expect(context.slideCount).toBe(25);expect(JSON.stringify(context)).toContain('FULL-DECK-25');expect(JSON.stringify(context)).toContain('NOTES-25');expect(context).not.toHaveProperty('fileBase64');
  target.begin();await target.invoke('prepare_powerpoint_images',args);
  const verification=JSON.parse(execFileSync(python!,['-c','import json,sys,zipfile;from pptx import Presentation;a=zipfile.ZipFile(sys.argv[1]);b=zipfile.ZipFile(sys.argv[2]);p=Presentation(sys.argv[2]);print(json.dumps({"otherPagesSame":all(a.read(n)==b.read(n) for n in a.namelist() if n.startswith("ppt/slides/slide") and n!="ppt/slides/slide1.xml"),"count":len(p.slides),"shapes":len(p.slides[0].shapes),"firstImageSame":p.slides[0].shapes[1].image.blob==Presentation(sys.argv[1]).slides[0].shapes[1].image.blob}))',meta.file,target.previewPath],{encoding:'utf8'}));
  expect(verification).toMatchObject({otherPagesSame:true,count:25,firstImageSame:true});
  expect(target.previewChanged).toBe(true);expect(request.mock.calls.every(call=>call[1]==='read')).toBe(true);
  expect(fs.existsSync(target.previewPath)).toBe(true);
 });
 it('rejects unselected shape IDs and unknown source images',async()=>{
  const {target,args}=setup();await target.read();target.begin();
  await expect(target.invoke('prepare_powerpoint_images',{replacements:[{...args.replacements[0],shapeId:meta.preservedShapeId}]})).rejects.toThrow('只能修改');
  await expect(target.invoke('prepare_powerpoint_images',{replacements:[{...args.replacements[0],imageId:'missing'}]})).rejects.toThrow();
 });
 it('confirms a frozen page once and keeps originals for a guarded undo',async()=>{
  const {target,args,request}=setup();await target.read();target.begin();await target.invoke('prepare_powerpoint_images',args);await target.commit();
  const applied=request.mock.calls.find(call=>call[1]==='apply')![2] as any;
  expect(applied.images.map((image:any)=>image.shapeId)).toEqual([meta.imageShapeId,meta.slotShapeId]);expect(applied.images[1].retainOriginal).toBe(true);
  expect(target.canUndo).toBe(true);await expect(target.commit()).rejects.toThrow();
  await target.undo();const undo=request.mock.calls.find(call=>call[1]==='undo')![2] as any;
  expect(undo.images).toHaveLength(1);expect(undo.images[0].shapeId).toBe(meta.imageShapeId);
 });
 it('refuses stale previews and never resends an uncertain write',async()=>{
  const {target,args,request,snapshot}=setup();await target.read();target.begin();await target.invoke('prepare_powerpoint_images',args);
  request.mockResolvedValueOnce({...snapshot,version:'changed'});await expect(target.commit()).rejects.toThrow('已改变');expect(request.mock.calls.some(call=>call[1]==='apply')).toBe(false);
  await target.read();target.begin();await target.invoke('prepare_powerpoint_images',args);
  request.mockImplementation(async(_id,method)=>{if(method==='apply')throw new Error('response lost');return snapshot;});
  await expect(target.commit()).rejects.toThrow('response lost');await expect(target.commit()).rejects.toThrow('没有可应用');
  expect(request.mock.calls.filter(call=>call[1]==='apply')).toHaveLength(1);
 });
 it('keeps V1 while preparing V2, rejects an incomplete candidate, then supports stepwise undo',async()=>{
  const {target,args,request,snapshot}=setup();await target.read();await target.begin();await target.invoke('prepare_powerpoint_images',args);await target.commit();
  const originalCalls=request.mock.calls.filter(call=>call[1]==='undo').length;
  await target.read();await target.begin();
  expect(target.canUndo).toBe(true);expect(target.revision).toBe(1);expect(request.mock.calls.filter(call=>call[1]==='undo')).toHaveLength(originalCalls);
  await expect(target.invoke('prepare_powerpoint_images',{replacements:[args.replacements[0]]})).rejects.toThrow('完整新版本');
  target.cancel();expect(target.canUndo).toBe(true);expect(target.revision).toBe(1);
  await target.read();await target.begin();await target.invoke('prepare_powerpoint_images',{replacements:args.replacements.map(item=>({...item,fit:'contain'}))});await target.commit();
  expect(target.revision).toBe(2);await target.undo();expect(target.revision).toBe(1);expect(target.canUndo).toBe(true);
  await target.undo();expect(target.revision).toBe(0);expect(target.canUndo).toBe(false);
  expect(request.mock.calls.filter(call=>call[1]==='undo').map(call=>(call[2] as any).expectedRevision)).toEqual([2,1]);
  expect(snapshot.selectedShapeIds).toHaveLength(2);
 });
 it('limits sources to the current generation and never leaves an earlier candidate after rejection',async()=>{
  const {target,args}=setup();await target.read();await target.begin([args.replacements[0].imageId]);
  await target.invoke('prepare_powerpoint_images',{replacements:[args.replacements[0]]});expect(target.previewChanged).toBe(true);
  await expect(target.invoke('prepare_powerpoint_images',args)).rejects.toThrow('来源图片');expect(target.previewChanged).toBe(false);
 });
 it('prepares a single-style text change alongside pictures and preserves unrelated ZIP entries',async()=>{
  const {target,args,snapshot}=setup();snapshot.selectedShapeIds.push('2');
  await target.read();await target.begin();
  await target.invoke('prepare_powerpoint_edit',{...args,texts:[{shapeId:'2',text:'新的团队介绍标题'}]});
  const check=JSON.parse(execFileSync(python!,['-c','import json,sys,zipfile;from pptx import Presentation;a=zipfile.ZipFile(sys.argv[1]);b=zipfile.ZipFile(sys.argv[2]);p=Presentation(sys.argv[2]);print(json.dumps({"title":p.slides[0].shapes[0].text,"fontSize":p.slides[0].shapes[0].text_frame.paragraphs[0].runs[0].font.size.pt,"otherPagesSame":all(a.read(n)==b.read(n) for n in a.namelist() if n.startswith("ppt/slides/slide") and n!="ppt/slides/slide1.xml")}))',meta.file,target.previewPath],{encoding:'utf8'}));
  expect(check).toMatchObject({title:'新的团队介绍标题',fontSize:20,otherPagesSame:true});
  await expect(target.invoke('prepare_powerpoint_edit',{texts:[{shapeId:'2',text:'第一行\n第二行'}]})).rejects.toThrow();expect(target.previewChanged).toBe(false);
 });
 it('a host pre-write refusal preserves V1 and a lost write receipt exposes uncertainty',async()=>{
  const {target,args,request,snapshot}=setup();await target.read();await target.begin();await target.invoke('prepare_powerpoint_images',args);await target.commit();
  await target.read();await target.begin();await target.invoke('prepare_powerpoint_images',args);
  request.mockImplementation(async(_id,method)=>{if(method==='apply')throw Object.assign(new Error('用户手改'),{mutationStarted:false});return snapshot;});
  await expect(target.commit()).rejects.toThrow('用户手改');expect(target.revision).toBe(1);expect(target.canUndo).toBe(true);expect(target.mutationUncertain).toBe(false);
  request.mockImplementation(async(_id,method)=>{if(method==='apply')throw new Error('回包丢失');return snapshot;});
  await expect(target.commit()).rejects.toThrow('写入结果未确认');expect(target.mutationUncertain).toBe(true);expect(target.canUndo).toBe(false);
 });
 it('preserves an ellipse mask across recreated picture IDs, and contain keeps all corners inside the ellipse',async()=>{
  const {target,args,request,snapshot}=setup();await target.read();await target.begin();await target.invoke('prepare_powerpoint_images',args);
  const firstBytes=fs.readFileSync(target.previewPath);
  const newId=execFileSync(python!,['-c','import sys;from pptx import Presentation;p=Presentation(sys.argv[1]);print(max(s.shape_id for s in p.slides[0].shapes if s.shape_type==13))',target.previewPath],{encoding:'utf8'}).trim();
  request.mockImplementation(async(_id,method)=>method==='apply'?{ok:true,mappings:[{oldId:meta.imageShapeId,newId:meta.imageShapeId},{oldId:meta.slotShapeId,newId}]} as any:snapshot);
  await target.commit();snapshot.fileBase64=firstBytes.toString('base64');snapshot.version='page-v2';snapshot.selectedShapeIds=[meta.imageShapeId,newId];snapshot.shapes[1]={...snapshot.shapes[1],id:newId,type:'Image'};
  await target.read();await target.begin();await target.invoke('prepare_powerpoint_images',{replacements:[args.replacements[0],{...args.replacements[1],shapeId:newId,fit:'contain'}]});
  await target.commit();const applied=request.mock.calls.filter(call=>call[1]==='apply').at(-1)![2] as any;
  expect(applied.images[1].geometry).toBe('ellipse');
  const inside=JSON.parse(execFileSync(python!,['-c','import sys,json,base64,io;from PIL import Image;i=Image.open(io.BytesIO(base64.b64decode(sys.stdin.read())));b=i.getchannel("A").getbbox();print(json.dumps({"inset":b[0]>0 and b[1]>0,"cornersInside":all(((x-i.width/2)/(i.width/2))**2+((y-i.height/2)/(i.height/2))**2<=1.03 for x in [b[0],b[2]] for y in [b[1],b[3]])}))'],{input:applied.images[1].base64,encoding:'utf8'}));
  expect(inside).toEqual({inset:true,cornersInside:true});
 });
});
