import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {compileVectorArtwork} from '../src/vector-art';
import {IllustratorLiveTarget,type IllustratorSnapshot} from '../src/targets/illustrator-live';
import type {OfficeBridge} from '../src/office-live/bridge';

const artwork={width:300,height:300,shapes:[{type:'ellipse',name:'主体',group:'瓶身',cx:150,cy:150,rx:70,ry:100,fill:'#a6dddd',stroke:'#123c48',strokeWidth:6,opacity:1}]};
const snapshot=():IllustratorSnapshot=>({anchorId:'anchor-a',version:'v1',document:{name:'合成测试.ai',url:'',artboards:[{name:'目标',rect:[0,300,300,0]}],items:[]},target:{artboardIndex:0,name:'目标',rect:[0,300,300,0]},previews:[{artboardIndex:0,dataUrl:'data:image/png;base64,cGl4ZWxz'}]});
const directories:string[]=[];
function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-illustrator-'));directories.push(root);
 const state=snapshot(),request=vi.fn(async(_id:string,method:string)=>method==='read'?structuredClone(state):method==='apply'?{resultId:'result-a'}:{undone:true});
 const target=new IllustratorLiveTarget(root,{request}as unknown as OfficeBridge,'session-a','测试画板',state);
 return {target,state,request};
}
afterEach(()=>{for(const root of directories.splice(0))fs.rmSync(root,{recursive:true,force:true});});
describe('Illustrator data-only vector output',()=>{
 it('compiles editable geometry and rejects embedded images, script attributes and malformed coordinates',()=>{
  const result=compileVectorArtwork(artwork);expect(result.svg).toContain('<ellipse');expect(result.svg).toContain('<g');expect(result.svg).not.toContain('<image');
  expect(()=>compileVectorArtwork({...artwork,shapes:[{...artwork.shapes[0],onload:'bad()'}]})).toThrow();
  expect(()=>compileVectorArtwork({...artwork,shapes:[{type:'image',href:'https://example.org/image.png'}]})).toThrow();
  expect(()=>compileVectorArtwork({...artwork,shapes:[{...artwork.shapes[0],cx:Infinity}]})).toThrow();
  expect(()=>compileVectorArtwork({...artwork,shapes:[{...artwork.shapes[0],type:'path',d:'<script>bad()</script>'}]})).toThrow();
 });
});
describe('Illustrator live target',()=>{
 it('prepares without writing, applies to the captured anchor and safely undoes its result',async()=>{
  const {target,request}=setup();await target.read();target.begin();await target.invoke('prepare_illustrator_artwork',{artwork,summary:'生成矢量角色'});
  expect(request.mock.calls.every(c=>c[1]==='read')).toBe(true);expect(fs.readFileSync(target.previewPath,'utf8')).toContain('<ellipse');
  await target.commit();expect(target.canUndo).toBe(true);expect(request).toHaveBeenCalledWith('session-a','apply',expect.objectContaining({anchorId:'anchor-a',expectedVersion:'v1',replaceResultId:''}));
  await target.undo();expect(request).toHaveBeenCalledWith('session-a','undo',{anchorId:'anchor-a',resultId:'result-a'});expect(target.canUndo).toBe(false);
 });
 it('rejects document changes and does not discard the previous result while preparing a continuation',async()=>{
  const {target,state,request}=setup();await target.read();target.begin();await target.invoke('prepare_illustrator_artwork',{artwork,summary:'第一版'});await target.commit();
  target.begin();expect(target.canUndo).toBe(true);expect(request.mock.calls.filter(c=>c[1]==='undo')).toHaveLength(0);
  await target.invoke('prepare_illustrator_artwork',{artwork,summary:'第二版'});state.version='v2';
  await expect(target.commit()).rejects.toThrow('文档已改变');expect(request.mock.calls.filter(c=>c[1]==='apply')).toHaveLength(1);expect(target.canUndo).toBe(true);
 });
 it('freezes uncertain writes; cancel never permits an unsafe replay',async()=>{
  const {target,request}=setup();await target.read();target.begin();await target.invoke('prepare_illustrator_artwork',{artwork,summary:'生成结果'});
  request.mockImplementation(async(_id,method)=>{if(method==='apply')throw new Error('结果未确认');return snapshot();});
  await expect(target.commit()).rejects.toThrow('结果未确认');target.cancel();expect(()=>target.begin()).toThrow('未确认');expect(target.canUndo).toBe(false);
 });
});
