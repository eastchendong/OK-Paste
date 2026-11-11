import{describe,expect,it,vi}from'vitest';
import{executionPolicyFor}from'../src/agent-core/execution-policy';
import{runToolLoop}from'../src/agent-core/tool-loop';
import{TaskWorkflow}from'../src/agent-core/task-workflow';

describe('agent core',()=>{
 it('single-pass finishes after one validated candidate; invalid proposals may be corrected within the budget',async()=>{
  const call=(name:string)=>({tool_calls:[{id:name,function:{name,arguments:'{}'}}]});
  const complete=vi.fn().mockResolvedValueOnce(call('unknown')).mockResolvedValueOnce(call('prepare'));
  const invoke=vi.fn(async()=>({applied:false}));
  await expect(runToolLoop({messages:[],tools:[{name:'prepare',description:'',inputSchema:{}}],mode:'single-pass',maxTurns:4,complete,invoke})).resolves.toMatchObject({calls:2});
  expect(complete).toHaveBeenCalledTimes(2);expect(invoke).toHaveBeenCalledOnce();
 });
 it('single-pass rejects a batch of conflicting candidates before invoking either tool',async()=>{
  const call={id:'one',function:{name:'prepare',arguments:'{}'}};
  const complete=vi.fn().mockResolvedValue({tool_calls:[call,{...call,id:'two'}]});const invoke=vi.fn();
  await expect(runToolLoop({messages:[],tools:[{name:'prepare',description:'',inputSchema:{}}],mode:'single-pass',maxTurns:1,complete,invoke})).rejects.toThrow('尚未完成');
  expect(invoke).not.toHaveBeenCalled();
 });
 it('keeps product state deterministic outside the model loop',()=>{
  const workflow=new TaskWorkflow();
  workflow.move('planning');workflow.move('ready');workflow.move('running');workflow.move('done');
  expect(workflow.phase).toBe('done');
  expect(()=>workflow.move('planning')).toThrow('无效任务状态');
  workflow.reset();expect(workflow.phase).toBe('idle');
 });

 it('selects the smallest execution strategy for each target capability',()=>{
  expect(executionPolicyFor('word-live')).toMatchObject({mode:'single-pass',requiresVisualVerification:false});
  expect(executionPolicyFor('powerpoint-live')).toMatchObject({mode:'single-pass'});
  expect(executionPolicyFor('figma-live')).toMatchObject({mode:'bounded-react',maxTurns:6});
  expect(executionPolicyFor('office-file')).toMatchObject({mode:'bounded-react',maxTurns:10});
 });

 it('runs typed tools, returns the final answer, and records tool failures as observations',async()=>{
  const complete=vi.fn()
   .mockResolvedValueOnce({tool_calls:[{id:'one',function:{name:'prepare_patch',arguments:'{"text":"完成"}'}}]})
   .mockResolvedValueOnce({content:'已完成修改。'});
  const invoke=vi.fn(async()=>({prepared:true}));
  const messages=[{role:'system',content:'test'}];
  await expect(runToolLoop({messages,tools:[{name:'prepare_patch',description:'prepare',inputSchema:{type:'object'}}],maxTurns:4,complete,invoke})).resolves.toEqual({summary:'已完成修改。',calls:1});
  expect(invoke).toHaveBeenCalledWith('prepare_patch',{text:'完成'});
  expect(messages.at(-2)).toMatchObject({role:'tool',tool_call_id:'one'});

  const unknown=vi.fn()
   .mockResolvedValueOnce({tool_calls:[{id:'bad',function:{name:'delete_everything',arguments:'{}'}}]})
   .mockResolvedValueOnce({content:'未执行。'});
  const history=[{role:'system',content:'test'}];
  await runToolLoop({messages:history,tools:[{name:'prepare_patch',description:'prepare',inputSchema:{}}],maxTurns:2,complete:unknown,invoke});
  expect(JSON.parse(String(history.at(-2)?.content))).toMatchObject({error:'目标没有这个工具'});
 });

 it('stops a tool loop at its target-specific turn budget',async()=>{
  const complete=vi.fn(async()=>({tool_calls:[{id:crypto.randomUUID(),function:{name:'inspect',arguments:'{}'}}]}));
  await expect(runToolLoop({messages:[],tools:[{name:'inspect',description:'inspect',inputSchema:{}}],maxTurns:2,complete,invoke:async()=>({ok:true})})).rejects.toThrow('尚未完成');
  expect(complete).toHaveBeenCalledTimes(2);
 });
 it('does not finish on an intermediate approval if the same batch later changes or rejects the candidate',async()=>{
  const call=(id:string)=>({id,function:{name:id,arguments:'{}'}});
  const complete=vi.fn().mockResolvedValueOnce({tool_calls:[call('review'),call('replace')]}).mockResolvedValueOnce({content:'候选未通过'});
  const invoke=vi.fn(async(name:string)=>{if(name==='review')return {readyToCommit:true,summary:'旧候选'};throw new Error('新候选无效');});
  const result=await runToolLoop({messages:[],tools:['review','replace'].map(name=>({name,description:'',inputSchema:{}})),mode:'bounded-react',maxTurns:3,complete,invoke});
  expect(result.summary).toBe('候选未通过');expect(complete).toHaveBeenCalledTimes(2);
 });
 it('places visual observations after all tool responses in a batch',async()=>{
  const call=(id:string)=>({id,function:{name:'prepare',arguments:'{}'}});
  const messages:any[]=[];
  const complete=vi.fn().mockResolvedValueOnce({tool_calls:[call('one'),call('two')]}).mockResolvedValueOnce({content:'已观察'});
  await runToolLoop({messages,tools:[{name:'prepare',description:'',inputSchema:{}}],mode:'bounded-react',maxTurns:2,complete,invoke:async()=>({images:['data:image/png;base64,AQID']})});
  expect(messages.map(message=>message.role)).toEqual(['assistant','tool','tool','user','assistant']);expect(messages[3].content).toHaveLength(3);
 });
});
