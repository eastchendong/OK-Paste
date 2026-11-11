import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {DeepSeekGateway} from '../src/agent-core/deepseek-gateway';
import {FollowupRecommender} from '../src/agent-core/followup-recommendations';
import {ModelGateway} from '../src/agent-core/model-gateway';
import {DirectExecutor,type DirectInput} from '../src/agent-core/direct-executor';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});vi.restoreAllMocks();vi.unstubAllGlobals();});
function root(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-execute-'));roots.push(root);fs.mkdirSync(path.join(root,'.local'));fs.writeFileSync(path.join(root,'.local/recommendations-config.json'),JSON.stringify({apiKey:'synthetic-secret'}));return root;}
function answer(name='prepare_text',args:unknown={text:'根据资料整理的内容'}){return {content:null,tool_calls:[{id:'call-1',function:{name,arguments:JSON.stringify(args)}}]};}
function setup(kind='input-live'){
 const complete=vi.fn().mockResolvedValue(answer());
 const gateway={complete,configured:()=>true} as unknown as DeepSeekGateway;
 const executor=new DirectExecutor(root(),gateway);
 const input:DirectInput={kind,instruction:'根据资料整理',context:{kind,revision:0},sources:[{id:'a',body:{text:'真实事实'}}],images:[],conversation:[],tools:[{name:'prepare_text',description:'文字候选',inputSchema:{type:'object'}}],invoke:vi.fn().mockResolvedValue({prepared:true}),signal:new AbortController().signal};
 return {complete,executor,input};
}
it.each([['word-live','prepare_word_patch'],['input-live','prepare_text'],['excel-live','prepare_excel_update'],['powerpoint-live','prepare_powerpoint_edit']])('%s 的正常候选只请求一次模型且不请求总结',async(kind,name)=>{
 const {complete,executor,input}=setup(kind);input.tools[0].name=name;complete.mockResolvedValue(answer(name));
 const result=await executor.execute(input);expect(result.metrics.requests).toBe(1);expect(complete).toHaveBeenCalledOnce();expect(input.invoke).toHaveBeenCalledOnce();expect(result.calls).toBe(1);
 const [messages,tools,options]=complete.mock.calls[0];expect(messages[0].content).not.toContain('真实事实');expect(messages[1].content[0].text).toContain('真实事实');expect(options).toMatchObject({stage:'execution',signal:input.signal});expect(tools.map((t:any)=>t.function.name)).toEqual([name,'request_clarification']);
});
it('必要追问不调用准备工具',async()=>{const {executor,complete,input}=setup();complete.mockResolvedValue(answer('request_clarification',{question:'请明确需要回复的时间。'}));expect(await executor.execute(input)).toMatchObject({question:'请明确需要回复的时间。',calls:0});expect(input.invoke).not.toHaveBeenCalled();});
it('参数校验失败只修正一次，并完整回传错误和工具结果',async()=>{
 const {executor,complete,input}=setup();vi.mocked(input.invoke).mockRejectedValueOnce(new Error('选区是2行3列')).mockResolvedValueOnce({prepared:true});
 expect((await executor.execute(input)).metrics.requests).toBe(2);expect(input.invoke).toHaveBeenCalledTimes(2);
 const messages=complete.mock.calls[1][0];expect(messages.some((m:any)=>m.role==='tool'&&m.content.includes('选区是2行3列'))).toBe(true);
});
it('持续校验失败不无限循环',async()=>{const {executor,complete,input}=setup();vi.mocked(input.invoke).mockRejectedValue(new Error('越出范围'));await expect(executor.execute(input)).rejects.toThrow('越出范围');expect(complete).toHaveBeenCalledTimes(2);});
it('拒绝一批多个工具，不执行其中任何一个',async()=>{const {executor,complete,input}=setup();complete.mockResolvedValue({tool_calls:[...answer().tool_calls,...answer().tool_calls]});await expect(executor.execute(input)).rejects.toThrow('只能调用一个');expect(input.invoke).not.toHaveBeenCalled();});
it('不执行提交、撤销或未知工具',async()=>{const {executor,complete,input}=setup();complete.mockResolvedValue(answer('commit'));await expect(executor.execute(input)).rejects.toThrow('准备工具');expect(input.invoke).not.toHaveBeenCalled();});
it('不接收非法 JSON 参数',async()=>{const {executor,complete,input}=setup();complete.mockResolvedValue({tool_calls:[{id:'bad',function:{name:'prepare_text',arguments:'{broken'}}]});await expect(executor.execute(input)).rejects.toThrow('JSON');expect(input.invoke).not.toHaveBeenCalled();});
it('模型失败不再请求一次，也不回退旧模型',async()=>{const {executor,complete,input}=setup();complete.mockRejectedValue(new Error('DeepSeek HTTP 429'));await expect(executor.execute(input)).rejects.toThrow('429');expect(complete).toHaveBeenCalledOnce();expect(input.invoke).not.toHaveBeenCalled();});
it('模型返回后取消，不准备任何候选',async()=>{const {executor,complete,input}=setup();const controller=new AbortController();input.signal=controller.signal;complete.mockImplementation(async()=>{controller.abort();return answer();});await expect(executor.execute(input)).rejects.toThrow();expect(input.invoke).not.toHaveBeenCalled();});
it('只读整页与非快速目标不执行',async()=>{const {executor,input,complete}=setup();input.context.captureScope='page';await expect(executor.execute(input)).rejects.toThrow('仅提供推荐');expect(complete).not.toHaveBeenCalled();expect(executor.supports('figma-live')).toBe(false);});
it('DeepSeek 复用独立 Key、关闭思考、要求工具输出并记录无正文计时',async()=>{
 const r=root(),fetchImpl=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:answer()}],usage:{completion_tokens:20}})));
 const gateway=new DeepSeekGateway(r,fetchImpl);expect(gateway.configured()).toBe(true);
 await gateway.complete([{role:'user',content:'private-synthetic-text'}],[],{stage:'execution',maxTokens:2048});
 const [url,options]=fetchImpl.mock.calls[0];expect(url).toBe('https://api.deepseek.com/chat/completions');expect(options.headers.Authorization).toBe('Bearer synthetic-secret');expect(JSON.parse(options.body)).toMatchObject({model:'deepseek-flash',thinking:{type:'disabled'},tool_choice:'required',max_tokens:2048});
 const log=fs.readFileSync(path.join(r,'.local/deepseek-events.ndjson'),'utf8');expect(log).not.toContain('synthetic-secret');expect(log).not.toContain('private-synthetic-text');expect(JSON.parse(log).durationMs).toBeGreaterThanOrEqual(0);
 fs.writeFileSync(path.join(r,'.local/execution-config.json'),JSON.stringify({enabled:false}));expect(gateway.configured()).toBe(false);
});
it.each([401,429,500])('HTTP %s 不泄漏响应正文中的密钥且不重试',async(status)=>{
 const r=root(),fetchImpl=vi.fn().mockResolvedValue(new Response('synthetic-secret',{status}));
 await expect(new DeepSeekGateway(r,fetchImpl).complete([],[],{stage:'execution',maxTokens:128})).rejects.toThrow('HTTP '+status);expect(fetchImpl).toHaveBeenCalledOnce();expect(fs.readFileSync(path.join(r,'.local/deepseek-events.ndjson'),'utf8')).not.toContain('synthetic-secret');
});
it('被截断的模型响应不能进入候选',async()=>{const fetchImpl=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{finish_reason:'length',message:answer()}]})));await expect(new DeepSeekGateway(root(),fetchImpl).complete([],[],{stage:'execution',maxTokens:128})).rejects.toThrow('输出预算');});

it('第二轮建议复用 DeepSeek Key，不再调用旧网关',async()=>{
 const legacy=vi.spyOn(ModelGateway.prototype,'complete');
 const fetchImpl=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:answer('present_followup_recommendations',{scene:null,suggestions:[]})}]})));
 vi.stubGlobal('fetch',fetchImpl);
 await new FollowupRecommender(root()).suggest({intent:{title:'合成写作'},currentResult:'合成成功片段',context:{kind:'word-live'},sources:[],images:[],conversation:[],tools:[]},new AbortController().signal);
 expect(fetchImpl).toHaveBeenCalledOnce();expect(legacy).not.toHaveBeenCalled();expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({model:'deepseek-flash',max_tokens:2048});
});
