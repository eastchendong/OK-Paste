import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {recommend} from '../src/agent-core/recommendations/core.mjs';
import {FileRunner} from '../src/file-runner';import {ClipboardStore} from '../src/clipboard/store';
import type {EditableTarget} from '../src/targets/editable-target';
const model=vi.hoisted(()=>({complete:vi.fn(),legacy:vi.fn()}));
vi.mock('../src/agent-core/recommendations/deepseek.mjs',()=>({deepseekComplete:()=>model.complete}));
vi.mock('../src/agent-client',()=>({AgentClient:class{planTarget=model.legacy;}}));
const roots:string[]=[];
afterEach(()=>{vi.resetAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const png=(s:string)=>'data:image/png;base64,'+Buffer.from(s).toString('base64');
const scenes=['vector-character','vector-icon','vector-empty-state'] as const;
const input=()=>({sources:[{id:'brief',kind:'text',text:'需要一个历史记录图标'}],target:{app:'Figma',scenario:'vector-artwork',capabilities:['vector'],documentText:'已有收藏与下载图标',referenceImages:[png('style')]}});
for(const scene of scenes)it('accepts one editable-vector requirement with '+scene+' metadata without needing a source bitmap',async()=>{
 const result=await recommend(input() as any,{complete:async()=>JSON.stringify({text:'按现有风格生成一个可编辑矢量作品',sourceIds:['brief'],output:'vector',scene})});
 expect(result.recommendation).toEqual({text:'按现有风格生成一个可编辑矢量作品',sourceIds:['brief'],output:'vector',scene});
});
it('rejects vector output for non-vector targets and refuses an unknown or missing vector purpose',async()=>{
 for(const [capabilities,scene] of [[['text'],'vector-icon'],[['vector'],null],[['vector'],undefined],[['vector'],'message']] as const){
  const data=input();(data.target as any).capabilities=capabilities;
  await expect(recommend(data as any,{complete:async()=>JSON.stringify({text:'生成图标',sourceIds:['brief'],output:'vector',scene})})).rejects.toThrow();
 }
});
it('labels target style images separately from source images and keeps both available to the model',async()=>{
 let messages:any;
 await recommend({...input(),sources:[{id:'photo',kind:'image',image:png('photo')}],target:{...input().target,screenshot:png('target')}} as any,{complete:async m=>{
  messages=m;return JSON.stringify({text:'根据照片补充同系列角色',sourceIds:['photo'],output:'vector',scene:'vector-character'});
 }});
 const content=messages[1].content,facts=JSON.parse(content[0].text);
 expect(facts.allowedOutputs).toEqual(['vector']);expect(facts.sources).toEqual([{id:'photo',kind:'image',text:'',hasImage:true}]);
 expect(content.filter((p:any)=>p.type==='image_url').map((p:any)=>p.image_url.url)).toEqual([png('photo'),png('target'),png('style')]);
 expect(content.filter((p:any)=>p.type==='text').map((p:any)=>p.text).join(' ')).toContain('referenceFrame');
 expect(content[0].text).not.toContain('base64');
});
async function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-figma-initial-'));roots.push(root);
 fs.mkdirSync(path.join(root,'.local'));fs.writeFileSync(path.join(root,'.local/recommendations-config.json'),JSON.stringify({apiKey:'synthetic'}));
 const store=new ClipboardStore(path.join(root,'sources')),item=store.add({type:'text',body:{text:'需要历史记录图标'}});
 let pictures=[png('captured'),png('reference')];
 const read=vi.fn(async()=>({fingerprint:'fixed',kind:'figma-live',target:{nodeId:'frame',name:'历史记录',width:24,height:24},document:{scope:'current-page',items:[{name:'收藏图标'}]},previewOrder:['frame','reference'],capabilities:{addEditableVectors:true,editExistingObjects:false}}));
 const target={kind:'figma-live',name:'历史记录',read,fingerprint:()=> 'fixed',get contextImages(){return pictures;},tools:()=>[],cancel:vi.fn(),dispose:vi.fn(),applyImmediately:true} as unknown as EditableTarget;
 model.complete.mockImplementation(async()=>JSON.stringify({text:'按已有线宽补一个历史记录图标',sourceIds:[item.id],output:'vector',scene:'vector-icon'}));
 const runner=new FileRunner(root,store);
 return {runner,target,store,item,read,changePictures:()=>{pictures=[png('different-page')];}};
}
it('uses the independent first-round module, freezing target visuals across material refreshes',async()=>{
 const {runner,target,store,read,changePictures}=await setup();
 await runner.useTarget(target);runner.ensurePlanned();await (runner as any).chain;
 expect(runner.status()).toMatchObject({phase:'ready',actions:['按已有线宽补一个历史记录图标'],initialRecommendation:{status:'ready'}});
 expect(model.legacy).not.toHaveBeenCalled();
 changePictures();store.add({type:'text',body:{text:'新增参考：保持单色'}});runner.ensurePlanned();await (runner as any).chain;
 expect(read).toHaveBeenCalledTimes(1);expect(model.complete).toHaveBeenCalledTimes(2);
 for(const [messages] of model.complete.mock.calls){
  const facts=JSON.parse(messages[1].content[0].text);
  expect(facts.targetBackground).toMatchObject({scenario:'vector-artwork',location:'历史记录',capabilities:['vector']});
  expect(facts.targetBackground.documentText).toContain('收藏图标');
  expect(messages[1].content.filter((p:any)=>p.type==='image_url').map((p:any)=>p.image_url.url)).toEqual([png('captured'),png('reference')]);
 }
 await runner.shutdown();
});
it('leaves Figma editable with no fabricated recommendation or legacy retry when purpose cannot be inferred',async()=>{
 const {runner,target,item}=await setup();
 model.complete.mockResolvedValue(JSON.stringify({text:'生成作品',sourceIds:[item.id],output:'vector',scene:null}));
 await runner.useTarget(target);runner.ensurePlanned();await (runner as any).chain;
 expect(runner.status()).toMatchObject({phase:'ready',actions:[],step:'请输入你的要求',initialRecommendation:{status:'unavailable'}});
 expect(model.legacy).not.toHaveBeenCalled();await runner.shutdown();
});
