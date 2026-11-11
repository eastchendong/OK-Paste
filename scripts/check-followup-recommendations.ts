/** Real-model smoke check; synthetic writing only, no desktop or document writes. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FollowupRecommender,type FollowupInput,type WritingScene} from '../src/agent-core/followup-recommendations';
import {ModelGateway} from '../src/agent-core/model-gateway';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cases:{scene:WritingScene;request:string;result:string;source:string;context:Record<string,unknown>}[]=[
 {scene:'document-fragment',request:'根据资料补充第二节活动安排，保留全部分工，不修改其他章节。',
  result:'阅读日将于周六上午九点在图书馆一层举行。小林负责签到，小李负责现场引导，小王负责图书整理。活动结束后，三人共同核对物料并归还。',
  source:'周六上午九点，图书馆一层。小林签到，小李引导，小王整理图书，结束后共同核对并归还物料。',
  context:{kind:'word-live',location:{section:'二、活动安排',before:'本次阅读日旨在促进校园交流。',after:'三、报名方式'},capabilities:'只替换本次新增的文字段落，支持段落和文字格式；其他章节不能修改。'}},
 {scene:'message',request:'给同学写一条活动通知，口语自然，保留准备事项和报名链接。',
  result:'各位同学，大家好！我们这次的阅读日活动有一些信息需要跟大家同步，请大家留意以下安排。参加时请带学生证和一本想分享的书，并提前填写 https://example.org/signup 。活动是本周六上午九点，在图书馆一层，欢迎参加。',
  source:'周六上午九点在图书馆一层举行阅读日。带学生证和一本分享书籍，填写 https://example.org/signup 报名。',
  context:{kind:'input-live',capabilities:'只修改本次输入框草稿，纯文字，不发送消息。'}},
 {scene:'task-brief',request:'把页面反馈整理成给开发或 AI 的简短修改任务，保留范围与完成标准，不替我确定未决定的颜色。',
  result:'需要调整活动页的报名入口，目前入口在页面底部，需要滚动才能发现。希望移到活动介绍之后，首屏可见，点击进入现有报名流程，移动端也不能遮挡正文。颜色还没决定，报名数据结构和后台接口不要改。',
  source:'反馈：用户找不到报名按钮。确定：放活动介绍后，首屏可见；点击沿用原报名流程；移动端不遮挡文字。不改报名数据和后台接口。按钮颜色待确认。',
  context:{kind:'input-live',capabilities:'只生成开发任务的文字草稿，不执行开发、不发送。'}},
];
const gateway=new ModelGateway(process.env.TUOTIE_MODEL_CONFIG_ROOT||root);
const recommender=new FollowupRecommender(root,async(messages,tools,signal)=>{
 const answer=await gateway.complete(messages,tools,signal);
 fs.mkdirSync(path.join(root,'.local'),{recursive:true});
 fs.writeFileSync(path.join(root,'.local','synthetic-followup-model-last.json'),JSON.stringify(answer,null,2));
 return answer;
}),results=[];
for(const sample of cases){
 const input:FollowupInput={intent:{title:sample.request,writingScene:sample.scene},currentResult:sample.result,context:sample.context,
  sources:[{id:'synthetic-brief',type:'text',body:{text:sample.source}}],images:[],conversation:[{role:'user',text:sample.request}],
  tools:[{name:'prepare_text',description:'只准备本次文字片段完整新版，保留其他内容',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']}}]};
 const started=Date.now();const result=await recommender.suggest(input,new AbortController().signal);
 if(result.scene!==sample.scene||!result.options.length)throw new Error(`明确场景 ${sample.scene} 没有返回可用建议`);
 results.push({durationMs:Date.now()-started,...result});
 console.log(JSON.stringify(results.at(-1)));
}
const directory=path.join(root,'.local');fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(path.join(directory,'followup-recommendations-smoke.json'),JSON.stringify({synthetic:true,at:new Date().toISOString(),results},null,2));
