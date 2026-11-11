import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {afterEach,it,expect,vi} from 'vitest';
import {FigmaLiveTarget,type FigmaSnapshot} from '../src/targets/figma-live';
import {runToolLoop} from '../src/agent-core/tool-loop';
import type {OfficeBridge} from '../src/office-live/bridge';
const artwork={width:300,height:300,shapes:[{type:'ellipse',name:'主体',group:'瓶身',cx:150,cy:150,rx:70,ry:100,fill:'#a6dddd',stroke:'#123c48',strokeWidth:6,opacity:1}]};
const directories:string[]=[];afterEach(()=>{for(const root of directories.splice(0))fs.rmSync(root,{recursive:true,force:true});});
function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-figma-'));directories.push(root);
 const snapshot:FigmaSnapshot={protocolVersion:2,anchorId:'a',version:'v1',document:{name:'合成测试',page:{id:'1',name:'角色'},pages:[],items:[],scope:'current-page'},target:{nodeId:'3',name:'新角色',width:300,height:300},previews:[]};
 let count=0;const results:string[]=[];
 const request=vi.fn(async(_id:string,method:string,args:any)=>{
  if(method==='read')return snapshot;if(method==='preview')return {image:'data:image/png;base64,AQID'};
  if(method==='apply'){const resultId=`result-${++count}`;results.push(resultId);return {resultId};}
  if(method==='undo'){results.pop();return {resultId:results.at(-1)||''};}return {ok:true};
 });
 const target=new FigmaLiveTarget(root,{request}as unknown as OfficeBridge,'s','新角色',snapshot);
 const prepare=()=>target.invoke('prepare_figma_artwork',{summary:'新角色',artwork});
 const review=async()=>{const candidate=await prepare();await target.invoke('review_figma_artwork',{candidateId:(candidate as any).candidateId,approved:true,issues:[]});};
 return {target,request,prepare,review,snapshot};
}
it('requires actual rendering and review before committing compiled SVG, with no model scripts or file access',async()=>{
 const {target,request,prepare}=setup();await target.read();target.begin();const candidate:any=await prepare();
 expect(candidate.images).toEqual(['data:image/png;base64,AQID']);await expect(target.commit()).rejects.toThrow('尚未完成');
 expect(request.mock.calls.some(c=>c[1]==='apply')).toBe(false);
 await target.invoke('review_figma_artwork',{candidateId:candidate.candidateId,approved:true,issues:[]});
 expect(await target.commit()).toEqual({summary:'新角色'});
 expect(request).toHaveBeenCalledWith('s','apply',expect.objectContaining({anchorId:'a',expectedVersion:'v1',expectedRevision:0,svg:expect.stringContaining('<ellipse')}));
 expect(request.mock.calls.find(c=>c[1]==='apply')![2]).not.toHaveProperty('svgPath');expect(target.canUndo).toBe(true);
 await target.undo();expect(target.canUndo).toBe(false);
});
it('keeps V1 while preparing or cancelling V2 and restores revision state in both directions',async()=>{
 const {target,request,review}=setup();await target.read();target.begin();await review();await target.commit();
 target.begin();expect(target.revision).toBe(1);expect(target.canUndo).toBe(true);target.cancel();
 target.begin();await review();await target.commit();expect(target.revision).toBe(2);
 expect(request.mock.calls.filter(c=>c[1]==='undo')).toHaveLength(0);
 await target.undo();expect(target.revision).toBe(1);expect(target.canUndo).toBe(true);
 expect((await target.read()).currentArtwork).toEqual(artwork);
 await target.undo();expect(target.revision).toBe(0);expect(target.canUndo).toBe(false);
});
it('invalidates review whenever a candidate changes, including malformed retries',async()=>{
 const {target,prepare}=setup();await target.read();target.begin();const first:any=await prepare();
 await target.invoke('review_figma_artwork',{candidateId:first.candidateId,approved:true,issues:[]});
 const second:any=await prepare();await expect(target.invoke('review_figma_artwork',{candidateId:first.candidateId,approved:true,issues:[]})).rejects.toThrow('最新候选');
 await expect(target.commit()).rejects.toThrow('尚未完成');
 await target.invoke('review_figma_artwork',{candidateId:second.candidateId,approved:true,issues:[]});
 await expect(target.invoke('prepare_figma_artwork',{artwork:{},summary:'坏候选'})).rejects.toThrow();expect(target.previewChanged).toBe(false);
});
it('distinguishes a confirmed prewrite refusal from a lost response',async()=>{
 const {target,request,review}=setup();await target.read();target.begin();await review();await target.commit();
 target.begin();await review();const original=request.getMockImplementation()!;
 request.mockImplementation(async(id,method,args)=>{if(method==='apply')throw Object.assign(new Error('冲突'),{mutationStarted:false});return original(id,method,args);});
 await expect(target.commit()).rejects.toThrow('冲突');expect(target.mutationUncertain).toBe(false);expect(target.canUndo).toBe(true);
 request.mockImplementation(async()=>{throw new Error('response lost');});
 await expect(target.commit()).rejects.toThrow('response lost'); // read fails before a mutation
 expect(target.mutationUncertain).toBe(false);
 request.mockImplementation(async(id,method,args)=>{if(method==='apply')throw new Error('response lost');return original(id,method,args);});
 await expect(target.commit()).rejects.toThrow('未确认');expect(target.mutationUncertain).toBe(true);expect(target.canUndo).toBe(false);
});
it('delivers actual candidate pixels to the next model turn before accepting its review',async()=>{
 const {target}=setup();await target.read();target.begin();let candidateId='';
 const complete=vi.fn(async(messages:any[])=>{
  if(!candidateId&&messages.length===0)return {tool_calls:[{id:'prepare',function:{name:'prepare_figma_artwork',arguments:JSON.stringify({artwork,summary:'新角色'})}}]};
  if(!candidateId){const tool=messages.find(message=>message.role==='tool');candidateId=JSON.parse(tool.content).candidateId;expect(tool.content).not.toContain('base64');expect(messages.at(-1).content[1]).toMatchObject({type:'image_url',image_url:{url:'data:image/png;base64,AQID'}});return {tool_calls:[{id:'review',function:{name:'review_figma_artwork',arguments:JSON.stringify({candidateId,approved:true,issues:[]})}}]};}
  return {content:'已检查部件比例与参考风格。'};
 });
 await runToolLoop({messages:[],tools:target.tools(),maxTurns:6,mode:'bounded-react',complete,invoke:(name,args)=>target.invoke(name,args)});
 await target.commit();expect(target.revision).toBe(1);expect(complete).toHaveBeenCalledTimes(2);
});
