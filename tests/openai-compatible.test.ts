import {afterEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {AgentClient} from '../src/agent-client';
import {modelConnection,chatMessages} from '../src/model-connection';
const roots:string[]=[],servers:http.Server[]=[];
afterEach(async()=>{vi.unstubAllGlobals();await Promise.all(servers.splice(0).map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));roots.splice(0).forEach(root=>fs.rmSync(root,{recursive:true,force:true}));});
function root(){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tuotie-openai-'));roots.push(directory);fs.mkdirSync(path.join(directory,'.local'));return directory;}
function config(root:string,base:string,model='compatible-vision',key='test-compatible-key'){
 fs.writeFileSync(path.join(root,'.env.local'),`OPENAI_BASE_URL=${JSON.stringify(base)}\nOPENAI_MODEL=${JSON.stringify(model)}\nOPENAI_API_KEY=${JSON.stringify(key)}\n`);
}
const plan={title:'补充笔记',summary:'在预览中补充',actions:['补充'],questions:[],needsClarification:false};
const completion=(message:unknown)=>({id:'chatcmpl-test',object:'chat.completion',created:1,model:'compatible-vision',choices:[{index:0,finish_reason:'stop',message}]});
describe('OpenAI-compatible Chat Completions',()=>{
 it('sends real HTTP vision and function-tool turns, then reloads connection settings',async()=>{
  const directory=root(),requests:{url:string;body:any;authorization?:string}[]=[];
  const server=http.createServer(async(req,res)=>{
   let data='';for await(const chunk of req)data+=chunk;
   const body=JSON.parse(data);requests.push({url:req.url!,body,authorization:req.headers.authorization});
   res.setHeader('content-type','application/json');
   if(!body.messages||body.reasoning_effort||body.messages.some((m:any)=>'reasoning_content' in m||m.tool_calls?.some((call:any)=>'index' in call))){res.statusCode=400;res.end(JSON.stringify({error:{message:'nonstandard request'}}));return;}
   if(body.tools?.some((tool:any)=>tool.function.name==='present_plan'))res.end(JSON.stringify(completion({role:'assistant',content:null,tool_calls:[{id:'plan-call',type:'function',function:{name:'present_plan',arguments:JSON.stringify(plan)}}]})));
   else if(!body.messages.some((m:any)=>m.role==='tool'))res.end(JSON.stringify(completion({role:'assistant',content:null,tool_calls:[{index:0,id:'edit-call',type:'function',function:{name:'edit_target',arguments:'{"text":"新笔记"}'}}]})));
   else res.end(JSON.stringify(completion({role:'assistant',content:'已在预览中补充笔记。'})));
  });servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as import('node:net').AddressInfo).port;
  config(directory,`http://127.0.0.1:${port}/v1/chat/completions/`);
  const client=new AgentClient(directory),image='data:image/png;base64,aGVsbG8=';
  expect(await client.planTarget({target:'test.docx',context:{},sources:[{id:'photo'}],images:[image],tools:[],conversation:[]})).toEqual(plan);
  expect(requests[0].url).toBe('/v1/chat/completions');expect(requests[0].authorization).toBe('Bearer test-compatible-key');
  expect(requests[0].body.messages[1].content).toContainEqual({type:'image_url',image_url:{url:image}});
  const invoke=vi.fn(async()=>({ok:true,preview:'已更新'}));
  const result=await client.executeTarget({target:'test.docx',plan,context:{},sources:[],images:[],conversation:[],tools:[{name:'edit_target',description:'修改预览',inputSchema:{type:'object',properties:{text:{type:'string'}}}}],invoke,onStep:()=>{}});
  expect(result.calls).toBe(1);expect(invoke).toHaveBeenCalledWith('edit_target',{text:'新笔记'});
  expect(requests[2].body.messages.find((m:any)=>m.role==='tool')).toMatchObject({tool_call_id:'edit-call',content:'{"ok":true,"preview":"已更新"}'});
  config(directory,`http://127.0.0.1:${port}/other/`,'another-model','');
  await client.planTarget({target:'test.docx',context:{},sources:[],images:[],tools:[],conversation:[]});
  expect(requests[3].url).toBe('/other/chat/completions');expect(requests[3].body.model).toBe('another-model');expect(requests[3].authorization).toBeUndefined();
 });
 it('uses the standard OpenAI token parameter without Ark extensions',async()=>{
  const directory=root();config(directory,'https://api.openai.com/v1','selected-model');
  const fetcher=vi.fn(async()=>new Response(JSON.stringify(completion({role:'assistant',tool_calls:[{id:'p',type:'function',function:{name:'present_plan',arguments:JSON.stringify(plan)}}]}))));vi.stubGlobal('fetch',fetcher);
  await new AgentClient(directory).planTarget({target:'test.docx',context:{},sources:[],images:[],tools:[],conversation:[]});
  const body=JSON.parse((fetcher.mock.calls[0] as any)[1].body);
  expect(body.max_completion_tokens).toBe(8192);expect(body).not.toHaveProperty('max_tokens');expect(body).not.toHaveProperty('reasoning_effort');
  expect(chatMessages([{role:'assistant',content:null,reasoning_content:'provider-only',tool_calls:[]}],false)[0]).not.toHaveProperty('reasoning_content');
 });
 it('preserves legacy Ark settings and honors an explicitly empty new Key',()=>{
  const directory=root();fs.writeFileSync(path.join(directory,'.env.local'),'ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/plan/v3\nARK_MODEL=glm-5.3-flash\nARK_API_KEY=test-legacy\n');
  expect(modelConnection(directory)).toMatchObject({ark:true,model:'glm-5.3-flash',key:'test-legacy',parameters:{reasoning_effort:'low'}});
  fs.appendFileSync(path.join(directory,'.env.local'),'OPENAI_BASE_URL=http://127.0.0.1:1234/v1\nOPENAI_MODEL=local-vision\nOPENAI_API_KEY=""\n');
  expect(modelConnection(directory)).toMatchObject({ark:false,key:'',model:'local-vision'});
 });
 it('redacts model credentials in error messages and logs',async()=>{
  const directory=root();config(directory,'https://compatible.example/v1','vision-model','test-private-key');
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:{message:'invalid token test-private-key'}}),{status:401})));
  await expect(new AgentClient(directory).planTarget({target:'test.docx',context:{},sources:[],images:[],tools:[],conversation:[]})).rejects.toThrow('invalid token [redacted]');
  expect(fs.readFileSync(path.join(directory,'.local/agent-api-events.ndjson'),'utf8')).not.toContain('test-private-key');
 });
});

it('shares the default DeepSeek credential and isolates other providers',async()=>{
 const directory=root();const {deepseekApiKey}=await import('../src/model-connection');
 const {DeepSeekGateway}=await import('../src/agent-core/deepseek-gateway');
 fs.writeFileSync(path.join(directory,'.env.local'),'OPENAI_API_KEY="synthetic-canonical"\n');
 fs.writeFileSync(path.join(directory,'.local/recommendations-config.json'),'{"apiKey":"synthetic-legacy"}');
 expect(modelConnection(directory)).toMatchObject({base:'https://api.deepseek.com',model:'deepseek-flash',key:'synthetic-canonical',parameters:{thinking:{type:'disabled'}}});
 expect(deepseekApiKey(directory)).toBe('synthetic-canonical');
 const mock=vi.fn(async(..._args:any[])=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',tool_calls:[]}}]})));
 await new DeepSeekGateway(directory,mock).complete([{role:'user',content:'synthetic'}],[],{stage:'execution',maxTokens:100});
 expect(mock.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
 expect(mock.mock.calls[0][1].headers.Authorization).toBe('Bearer synthetic-canonical');
 config(directory,'https://other.example/v1','other-model','other-provider-key');
 expect(deepseekApiKey(directory)).toBe('synthetic-legacy');
 fs.rmSync(path.join(directory,'.local/recommendations-config.json'));expect(deepseekApiKey(directory)).toBe('');
 fs.writeFileSync(path.join(directory,'.env.local'),'ARK_API_KEY=synthetic-old-provider\n');
 expect(modelConnection(directory)).toMatchObject({model:'deepseek-flash',key:''});
});

it('replays provider tool responses without stream-only fields while preserving call pairing and image pixels',()=>{
 const image='data:image/png;base64,cGl4ZWxz';
 const history=[{role:'assistant',content:null,reasoning_content:'private',tool_calls:[{index:0,id:'actual-call',type:'function',provider_extra:true,function:{name:'look',arguments:'{}',extra:1}}]},
 {role:'tool',tool_call_id:'actual-call',content:'{"ok":true}'},
 {role:'user',content:[{type:'image_url',image_url:{url:image}}]}];
 const normalized=chatMessages(history,false);
 expect(normalized[0]).toEqual({role:'assistant',content:null,tool_calls:[{id:'actual-call',type:'function',function:{name:'look',arguments:'{}'}}]});
 expect(normalized.slice(1)).toEqual(history.slice(1));
 expect(history[0].tool_calls?.[0].index).toBe(0);
 expect(chatMessages(history,true)[0].reasoning_content).toBe('private');
});

it('bounds automatic Blender visual correction and returns the actual final checked image',async()=>{
 const directory=root();config(directory,'https://compatible.example/v1');
 const requests:any[]=[],steps=['execute_blender_code','look','execute_blender_code','look',null];
 vi.stubGlobal('fetch',vi.fn(async(_url:any,options:any)=>{
  const body=JSON.parse(options.body);requests.push(body);const name=steps[requests.length-1];
  return new Response(JSON.stringify(completion(name?{role:'assistant',tool_calls:[{id:'step-'+requests.length,type:'function',function:{name,arguments:name==='execute_blender_code'?'{"code":"pass"}':'{}'}}]}:{role:'assistant',content:'已检查预览，请确认。'})));
 }));
 const image='data:image/png;base64,aGVsbG8=';
 const client={toolDefinitions:['execute_blender_code','look'].map(name=>({name,inputSchema:{type:'object'}})),agentOp:vi.fn(async()=>({ok:true})),raw:vi.fn(async()=>({content:[{type:'image',mimeType:'image/png',data:'aGVsbG8='}]}))};
 const result=await new AgentClient(directory).execute({taskId:'isolated',plan,context:{},source:'',sceneImage:image,assets:[],conversation:[],client:client as any,onStep:()=>{}});
 expect(client.agentOp).toHaveBeenCalledTimes(2);expect(client.raw).toHaveBeenCalledTimes(2);
 expect(requests[4].tools.map((t:any)=>t.function.name)).toEqual(['look']);
 expect(requests[4].messages.at(-1).content).toContainEqual({type:'image_url',image_url:{url:image}});
 expect(result.previewImage).toBe(image);
});

it('requires the structured planning tool on DeepSeek while keeping execution tool choice automatic',async()=>{
 const directory=root();config(directory,'https://api.deepseek.com','deepseek-flash','synthetic-key');
 const bodies:any[]=[];vi.stubGlobal('fetch',vi.fn(async(_url:any,options:any)=>{bodies.push(JSON.parse(options.body));return new Response(JSON.stringify(completion({role:'assistant',tool_calls:[{id:'plan',type:'function',function:{name:'present_plan',arguments:JSON.stringify(plan)}}]})));}));
 await new AgentClient(directory).planTarget({target:'test.docx',context:{},sources:[],images:[],tools:[],conversation:[]});
 expect(bodies[0].tool_choice).toBe('required');
 const {ModelGateway}=await import('../src/agent-core/model-gateway');
 await new ModelGateway(directory).complete([{role:'user',content:'synthetic'}],[{type:'function',function:{name:'look',description:'Look',parameters:{type:'object'}}}]);
 expect(bodies[1].tool_choice).toBe('auto');
});
