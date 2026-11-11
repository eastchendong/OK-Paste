import {afterEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AgentClient} from '../src/agent-client';
let directory='';
afterEach(()=>{if(directory)fs.rmSync(directory,{recursive:true,force:true});vi.restoreAllMocks();});
describe('target model image input',()=>{
 it('passes source images as images without duplicating their bytes into text context',async()=>{
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-model-'));fs.mkdirSync(path.join(directory,'.local'));
  fs.writeFileSync(path.join(directory,'.env.local'),'ARK_API_KEY=unit-test\nARK_BASE_URL=https://ark.cn-beijing.volces.com/api/plan/v3\nARK_MODEL=glm-5.3-flash\n');
  const model=new AgentClient(directory);
  const request=vi.spyOn(model as any,'request').mockResolvedValue({tool_calls:[{function:{name:'present_plan',arguments:JSON.stringify({title:'插入参考图片',summary:'在文末插入图片',actions:[],questions:[],needsClarification:false,suggestions:['在文末插入参考图片']})}}]});
  const image='data:image/png;base64,encoded-image-payload';
  await model.planTarget({target:'research.docx',context:{paragraphs:[]},sources:[{id:'image-1',type:'image'}],images:[image,image],tools:[],conversation:[]});
  const messages=request.mock.calls[0][0] as {content:any[]}[];
  const content=messages[1].content;
  expect(content.filter((part:{type:string})=>part.type==='image_url')).toHaveLength(1);
  expect(content[0].text).not.toContain('encoded-image-payload');
  expect(content[1].image_url.url).toBe(image);
 });
});

function plannerWithReplies(...plans:unknown[]){
 directory=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-model-'));fs.mkdirSync(path.join(directory,'.local'));
 const model=new AgentClient(directory),request=vi.spyOn(model as any,'request');
 for(const plan of plans)request.mockResolvedValueOnce({tool_calls:[{function:{name:'present_plan',arguments:JSON.stringify(plan)}}]});
 const input={target:'测试 PPT',context:{kind:'powerpoint-live'},sources:[],images:[],tools:[],conversation:[],recommendationCount:1 as const};
 return {model,request,input};
}
const emptyRecommendation={title:'修改标题',summary:'结合资料改标题',actions:['改标题'],questions:[],needsClarification:false,suggestions:[]};
it('repairs a missing automatic recommendation once without inventing one from the title or actions',async()=>{
 const s=plannerWithReplies(emptyRecommendation,{...emptyRecommendation,suggestions:['将选中标题改为阅读活动团队']});
 const plan=await s.model.planTarget(s.input);expect(plan.suggestions).toEqual(['将选中标题改为阅读活动团队']);expect(s.request).toHaveBeenCalledTimes(2);
});
it('bounds recommendation repair and preserves a visible error if the model still returns none',async()=>{
 const s=plannerWithReplies(emptyRecommendation,emptyRecommendation);
 await expect(s.model.planTarget(s.input)).rejects.toThrow('未返回默认推荐');expect(s.request).toHaveBeenCalledTimes(2);
});
it('does not retry a clarification or an explicit user plan just because suggestions are empty',async()=>{
 const clarification={...emptyRecommendation,needsClarification:true,questions:['需要替换哪张图片？']};
 const s=plannerWithReplies(clarification,emptyRecommendation);
 expect((await s.model.planTarget(s.input)).needsClarification).toBe(true);
 await s.model.planTarget({...s.input,conversation:[{role:'user',text:'将标题缩短'}]});
 expect(s.request).toHaveBeenCalledTimes(2);
});
