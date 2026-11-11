import fs from'node:fs';
import path from'node:path';
import{modelConnection,chatMessages}from'../model-connection';
import type{AgentAnswer,AgentMessage,ModelTool}from'./contracts';

/** Provider boundary. Orchestration and target adapters remain vendor-neutral. */
export class ModelGateway{
 constructor(private root:string){}
 get base(){return modelConnection(this.root).base;}
 get model(){return modelConnection(this.root).model;}
 async complete(messages:AgentMessage[],tools:ModelTool[]=[],signal?:AbortSignal,maxTokens?:number):Promise<AgentAnswer>{
  const connection=modelConnection(this.root);
  if((connection.ark||new URL(connection.base).hostname==='api.deepseek.com')&&!connection.key)throw Error('请在妥帖设置中配置 API Key。');
  const started=Date.now();
  const response=await fetch(connection.endpoint,{method:'POST',signal:AbortSignal.any([AbortSignal.timeout(120000),...(signal?[signal]:[])]),headers:{'Content-Type':'application/json',...(connection.key?{Authorization:'Bearer '+connection.key}:{})},body:JSON.stringify({model:connection.model,messages:chatMessages(messages as Record<string,any>[],connection.ark),...connection.parameters,...(maxTokens?('max_completion_tokens' in connection.parameters?{max_completion_tokens:maxTokens}:{max_tokens:maxTokens}):{}),...(tools.length?{tools,tool_choice:new URL(connection.base).hostname==='api.deepseek.com'&&tools.length===1&&tools[0].function.name==='present_plan'?'required':'auto'}:{})})});
  if(!response.ok){
   const body=await response.json().catch(()=>null)as any;
   const detail=typeof body?.error?.message==='string'?(connection.key?body.error.message.replaceAll(connection.key,'[redacted]'):body.error.message).slice(0,600):'';
   fs.appendFileSync(path.join(this.root,'.local/agent-api-events.ndjson'),JSON.stringify({at:new Date().toISOString(),durationMs:Date.now()-started,status:response.status,error:detail})+'\n');
   throw Error(`模型接口返回 HTTP ${response.status}。${detail}`);
  }
  const result=await response.json()as any;
  fs.appendFileSync(path.join(this.root,'.local/agent-api-events.ndjson'),JSON.stringify({at:new Date().toISOString(),durationMs:Date.now()-started,usage:result.usage,finishReason:result.choices?.[0]?.finish_reason,tools:result.choices?.[0]?.message?.tool_calls?.map((tool:any)=>tool.function?.name)})+'\n');
  if(result.choices?.[0]?.finish_reason==='length')throw Error('模型达到输出预算，尚未完成本轮，请重试或缩小这次请求。');
  const answer=result.choices?.[0]?.message;
  if(!answer)throw Error('模型没有返回消息。');
  return answer;
 }
}
