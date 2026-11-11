import {deepseekApiKey,DEFAULT_MODEL,DEFAULT_MODEL_BASE,chatMessages} from '../model-connection';
import fs from 'node:fs';
import path from 'node:path';
import type {AgentAnswer,AgentMessage,ModelTool} from './contracts';

type Options={stage:'execution'|'followup';maxTokens:number;timeoutMs?:number;signal?:AbortSignal};
/** Dedicated execution connection; shares the existing local DeepSeek credential, never the legacy key. */
export class DeepSeekGateway {
 constructor(private root:string,private fetchImpl:typeof fetch=fetch){}
 configured(){
  const rollback=path.join(this.root,'.local/execution-config.json');
  if(fs.existsSync(rollback)&&JSON.parse(fs.readFileSync(rollback,'utf8')).enabled===false)return false;
  return Boolean(this.key());
 }
 private key(){return deepseekApiKey(this.root);}
 async complete(messages:AgentMessage[],tools:ModelTool[],options:Options):Promise<AgentAnswer>{
  const key=this.key();if(!key)throw new Error('请先配置 DeepSeek API Key');
  const started=performance.now();
  const signal=AbortSignal.any([AbortSignal.timeout(options.timeoutMs??30000),...(options.signal?[options.signal]:[])]);
  const log=(details:Record<string,unknown>)=>{
   // Observability must not change a successfully received model result.
   try{fs.mkdirSync(path.join(this.root,'.local'),{recursive:true});fs.appendFileSync(path.join(this.root,'.local/deepseek-events.ndjson'),JSON.stringify({at:new Date().toISOString(),stage:options.stage,model:DEFAULT_MODEL,durationMs:Math.round(performance.now()-started),...details})+'\n');}catch{}
  };
  let response:Response;
  try{response=await this.fetchImpl(DEFAULT_MODEL_BASE+'/chat/completions',{
   method:'POST',signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},
   body:JSON.stringify({model:DEFAULT_MODEL,messages:chatMessages(messages as Record<string,any>[],false),thinking:{type:'disabled'},max_tokens:options.maxTokens,stream:false,tools,tool_choice:'required'})
  });}catch{log({ok:false,reason:signal.aborted?'aborted':'network'});if(options.signal?.aborted)throw new Error('任务已取消');throw new Error(signal.aborted?'DeepSeek 请求超时，请稍后重试':'DeepSeek 暂时无法连接');}
  if(!response.ok){log({ok:false,status:response.status});throw new Error(`DeepSeek 接口返回 HTTP ${response.status}`);}
  let result:any;
  try{result=await response.json();}catch{log({ok:false,reason:'invalid_response'});throw new Error('DeepSeek 返回的数据不完整');}
  signal.throwIfAborted();
  const choice=result.choices?.[0];
  log({ok:choice?.finish_reason==='tool_calls',finishReason:choice?.finish_reason,usage:result.usage,tools:choice?.message?.tool_calls?.map((call:any)=>call.function?.name)});
  if(choice?.finish_reason==='length')throw new Error('本次修改超出输出预算，请缩小修改范围');
  if(choice?.finish_reason!=='tool_calls'||!choice.message)throw new Error('DeepSeek 未返回有效修改，请重试');
  return choice.message;
 }
}
