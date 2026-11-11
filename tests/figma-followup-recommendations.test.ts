import {expect,it} from 'vitest';
import {FollowupRecommender,type FollowupInput} from '../src/agent-core/followup-recommendations';
import {captureFollowupBaseline,followupScope} from '../src/agent-core/followup-scope';
const artwork={width:100,height:100,shapes:[{type:'ellipse',name:'主体',group:'主体',cx:50,cy:50,rx:30,ry:30,fill:'#aadddd',stroke:'#123456',strokeWidth:2,opacity:1}]};
const contexts=()=>({kind:'figma-live',target:{nodeId:'frame',name:'新作品',width:100,height:100},document:{items:[{name:'初始参考'}]},previewOrder:['frame','style'],revision:1,currentArtwork:artwork,capabilities:{addEditableVectors:true,editExistingObjects:false,visualReview:true}});
const png=(v:string)=>'data:image/png;base64,'+Buffer.from(v).toString('base64');
function input():FollowupInput{const context=contexts();return {intent:{title:'按已有风格补充矢量作品'},currentResult:JSON.stringify(artwork),context,baseline:captureFollowupBaseline({...context,currentArtwork:null,revision:0}),sources:[{id:'brief',type:'text',body:{text:'已确认需求'}}],images:[png('current'),png('style')],conversation:[{role:'user',text:'按已有风格补充作品'}],tools:[{name:'prepare_figma_artwork',description:'只改本任务作品',inputSchema:{}},{name:'review_figma_artwork',description:'实际看图',inputSchema:{}}]};}
const option=(direction:string,label=direction)=>({direction,label,instruction:'只调整本任务作品，保持原语义、系列风格、画框和其他图层不变。'});
async function suggest(data:FollowupInput,scene:string,suggestions:unknown[]){return new FollowupRecommender('/tmp',async()=>({content:JSON.stringify({scene,suggestions})})).suggest(data,new AbortController().signal);}
for(const [scene,allowed,wrong] of [
 ['vector-character',['vector-shape','vector-expression','vector-simplify'],'vector-symbol'],
 ['vector-icon',['vector-simplify','vector-weight','vector-symbol'],'vector-expression'],
 ['vector-empty-state',['vector-simplify','vector-mood','vector-emphasis'],'vector-shape'],
] as const)it('filters '+scene+' changes by actual vector capability and deduplicates directions',async()=>{
 const data=input();
 const items=[option(allowed[0],'第一项'),option(wrong,'不适用项'),option(allowed[0],'重复维度')];
 expect((await suggest(data,scene,items)).options).toEqual([items[0]]);
 for(const direction of allowed)expect((await suggest(data,scene,[option(direction)])).options).toHaveLength(1);
 expect((await suggest(data,'message',[option('tone')])).options).toEqual([]);
});
it('freezes original frame identity and style facts without storing the old artwork',()=>{
 const context=contexts(),baseline=captureFollowupBaseline(context);context.target.name='后来改名';(context.document.items[0] as any).name='后来参考';
 expect(baseline).toMatchObject({target:{nodeId:'frame',name:'新作品'},document:{items:[{name:'初始参考'}]},previewOrder:['frame','style']});
 expect(baseline).not.toHaveProperty('currentArtwork');
});
it('does not request suggestions for wrong-frame, missing artwork or non-vector capability',async()=>{
 for(const change of [{target:{nodeId:'different'}},{currentArtwork:null},{currentArtwork:{shapes:[]}},{capabilities:{addEditableVectors:false}}]){
  const data=input();Object.assign(data.context as object,change);
  const rec=new FollowupRecommender('/tmp',async()=>{throw new Error('not allowed to request');});
  expect(await rec.suggest(data,new AbortController().signal)).toEqual({scene:null,options:[]});
 }
 expect(followupScope({...contexts(),kind:'illustrator-live'},input().baseline)).toBeNull();
});
it('requires the actual Figma edit and review tools before suggesting vector changes',async()=>{
 const data=input();data.tools=[];
 expect(await suggest(data,'vector-icon',[option('vector-simplify')])).toEqual({scene:null,options:[]});
});
it('preserves a recognized scene with zero options and supports unknown purpose without inventing chips',async()=>{
 expect(await suggest(input(),'vector-icon',[])).toEqual({scene:'vector-icon',options:[]});
 expect(await suggest(input(),null as any,[])).toEqual({scene:null,options:[]});
});
it('sends the current committed image first with explicit roles, and keeps image bytes out of text',async()=>{
 const data=input();(data as any).imageRoles=['current-committed-frame','frozen-reference-frame'];
 let messages:any;
 await new FollowupRecommender('/tmp',async m=>{messages=m;return {content:JSON.stringify({scene:'vector-icon',suggestions:[]})};}).suggest(data,new AbortController().signal);
 expect(messages).toBeDefined();const parts=messages[1].content,facts=JSON.parse(parts[0].text);
 expect(facts.imageCoverage.order).toEqual(['current-committed-frame','frozen-reference-frame']);
 expect(parts[0].text).not.toContain('base64');
 expect(parts.slice(1).map((p:any)=>p.image_url.url)).toEqual([png('current'),png('style')]);
});
