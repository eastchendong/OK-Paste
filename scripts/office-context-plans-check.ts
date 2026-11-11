import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {AgentClient} from '../src/agent-client';
import {ClipboardStore} from '../src/clipboard/store';
import {OfficeFile} from '../src/targets/office-file';

const root=process.cwd(),directory=path.join(root,'.local/office-check-fixtures');
const store=new ClipboardStore(path.join(root,'.local/office-plan-check-clipboard'));
const agent=new AgentClient(root);
const sources=[{id:'synthetic-research-note',type:'text',source:{title:'用于联调的合成研究笔记'},body:{text:'两次探索性访谈中，用户希望复制来源后结合目标内容看到可执行建议，先预览、可撤回。样本有限，不能推广为所有用户结论。研究计划：原型访谈计划 8 人次已完成 2；交互测试计划 6 已完成 3；场景验证计划 4 已完成 1。'}}];
const results=[];
for(const extension of ['docx','xlsx','pptx']){
 const target=new OfficeFile(root,path.join(directory,'research.'+extension),store);
 const context=await target.read();
 const plan=await agent.planTarget({target:target.name,context,sources,images:[],tools:target.tools(),conversation:[]});
 assert(plan.suggestions?.length,'Expected independent context-based recommendations');
 results.push({extension,kind:context.kind,plan});
 console.log(extension,JSON.stringify(plan.suggestions));
}
assert(new Set(results.map(result=>JSON.stringify(result.plan.suggestions))).size===3);
const evidence={checkedAt:new Date().toISOString(),source:'the same synthetic text note in all three cases',scope:'real Agent Plan plus actual saved file context; no file modifications',results};
fs.writeFileSync(path.join(root,'.local/office-context-plans.json'),JSON.stringify(evidence,null,2));
