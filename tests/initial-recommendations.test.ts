import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {FileRunner} from '../src/file-runner';
import {ClipboardStore} from '../src/clipboard/store';
import type {EditableTarget} from '../src/targets/editable-target';
const mocks=vi.hoisted(()=>({complete:vi.fn(),legacy:vi.fn()}));
vi.mock('../src/agent-core/recommendations/deepseek.mjs',()=>({deepseekComplete:()=>mocks.complete}));
vi.mock('../src/agent-client',()=>({AgentClient:class{planTarget=mocks.legacy;}}));
const roots:string[]=[];
afterEach(()=>{for(const p of roots.splice(0))fs.rmSync(p,{recursive:true,force:true});vi.clearAllMocks();});
function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-native-rec-'));roots.push(root);
 fs.mkdirSync(path.join(root,'.local'));fs.writeFileSync(path.join(root,'.local/recommendations-config.json'),JSON.stringify({apiKey:'synthetic-key'}));
 const store=new ClipboardStore(path.join(root,'clipboard'));
 const item=store.add({type:'text',body:{text:'签到岗两人，引导岗三人'}});
 const read=vi.fn(async()=>({fingerprint:'fixed',body:'一、背景\n二、人员安排\n三、后续',location:{section:'二、人员安排',before:'二、人员安排',after:'三、后续'},blockInsertionAvailable:true}));
 const target={kind:'word-live',name:'独立测试稿',read,fingerprint:()=> 'fixed',tools:()=>[],cancel:vi.fn(),dispose:vi.fn(),applyImmediately:true} as unknown as EditableTarget;
 const runner=new FileRunner(root,store);
 mocks.complete.mockImplementation(async()=>JSON.stringify({text:'根据资料补充人员分工。',sourceIds:[item.id],output:'text'}));
 return {runner,target,read,store,item};
}
it('原版任务直接消费单条 DeepSeek 推荐，冻结首次读取且不调用旧规划模型',async()=>{
 const {runner,target,read,store}=setup();await runner.useTarget(target);runner.ensurePlanned();await (runner as any).chain;
 expect(runner.status()).toMatchObject({phase:'ready',actions:['根据资料补充人员分工。']});
 expect(read).toHaveBeenCalledTimes(1);expect(mocks.legacy).not.toHaveBeenCalled();
 const message=mocks.complete.mock.calls[0][0][1].content[0].text;
 expect(JSON.parse(message).targetBackground.documentText).toContain('三、后续');
 store.add({type:'text',body:{text:'引导岗提前十分钟到场'}});runner.ensurePlanned();await (runner as any).chain;
 expect(read).toHaveBeenCalledTimes(1);expect(mocks.complete).toHaveBeenCalledTimes(2);
 await runner.shutdown();
});
it.each(['excel-live','powerpoint-live'])('适配 %s 的结构化目标与专属推荐模板，不调用旧规划',async(kind)=>{
 const {runner,target,read,item}=setup();
 Object.assign(target,{kind,locationLabel:kind==='excel-live'?'Sheet1!A2:D4':'第 1 页'});
 read.mockResolvedValue({fingerprint:'fixed',selection:{address:'Sheet1!A2:D4',values:[['','','','']]},workbook:{sheets:[{name:'Sheet1',usedRange:{values:[['公司','岗位','地点','要求']]}}]},captureScope:'page',currentPage:{shapes:[{id:'1',type:'Image'},{id:'2',text:'周桂兰'},{id:'3',text:'陈建国'}]}} as any);
 mocks.complete.mockResolvedValue(JSON.stringify({text:'根据资料补充当前区域。',sourceIds:[item.id],output:'text'}));
 await runner.useTarget(target);runner.ensurePlanned();await (runner as any).chain;
 expect(runner.status().phase).toBe('ready');expect(mocks.legacy).not.toHaveBeenCalled();
 const input=JSON.parse(mocks.complete.mock.calls[0][0][1].content[0].text);
 expect(input.targetBackground.scenario).toBe(kind==='excel-live'?'spreadsheet':'persona-slides');
 expect(input.targetBackground.documentText).toContain(kind==='excel-live'?'公司':'周桂兰');
 expect(read).toHaveBeenCalledTimes(1);
 Object.assign(target,{recommendationOnly:true});
 expect(runner.run({itemIds:[item.id],actionIndex:0})).toMatchObject({ok:false,error:'当前页面仅提供推荐，暂不执行修改'});
 await runner.shutdown();
});
it('推荐失败保留可输入状态，不显示重试或调用旧模型兜底',async()=>{
 const {runner,target}=setup();mocks.complete.mockRejectedValue(new Error('upstream secret'));
 await runner.useTarget(target);runner.ensurePlanned();await (runner as any).chain;
 expect(runner.status()).toMatchObject({phase:'ready',actions:[],error:'',step:'请输入你的要求'});
 expect(mocks.legacy).not.toHaveBeenCalled();await runner.shutdown();
});
