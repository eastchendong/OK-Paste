import type{AgentAnswer,AgentMessage,AgentToolDefinition,ModelTool}from'./contracts';

export type ToolLoopResult={summary:string;calls:number};

type ToolLoopInput={
 messages:AgentMessage[];
 tools:AgentToolDefinition[];
 maxTurns:number;
 mode?:'single-pass'|'bounded-react';
 signal?:AbortSignal;
 complete:(messages:AgentMessage[],tools:ModelTool[],signal?:AbortSignal)=>Promise<AgentAnswer>;
 invoke:(name:string,args:Record<string,unknown>)=>Promise<unknown>;
 onStep?:(name:string)=>void;
 onCall?:(event:{name:string;output:unknown})=>void;
};

/** Bounded provider-neutral tool loop. Target adapters retain every side effect. */
export async function runToolLoop(input:ToolLoopInput):Promise<ToolLoopResult>{
 const tools:ModelTool[]=input.tools.map(tool=>({type:'function',function:{name:tool.name,description:tool.description,parameters:tool.inputSchema}}));
 let calls=0;
 for(let turn=0;turn<input.maxTurns;turn++){
  if(input.signal?.aborted)throw new Error('任务已取消');
  const answer=await input.complete(input.messages,tools,input.signal);
  if(input.signal?.aborted)throw new Error('任务已取消');
  input.messages.push({role:'assistant',content:answer.content??null,...(answer.reasoning_content?{reasoning_content:answer.reasoning_content}:{}),...(answer.tool_calls?{tool_calls:answer.tool_calls}:{})});
  if(!answer.tool_calls?.length)return{summary:answer.content||'请查看实际结果。',calls};
  const observations:string[]=[];let readySummary:string|undefined;
  for(const call of answer.tool_calls){
   if(input.signal?.aborted)throw new Error('任务已取消');
   const name=call.function?.name||'';let output:unknown;
   try{
    if(input.mode==='single-pass'&&answer.tool_calls.length!==1)throw new Error('请只提交一个完整修改版本，不要同时调用多个工具');
    if(!input.tools.some(tool=>tool.name===name))throw new Error('目标没有这个工具');
    input.onStep?.(name);
    output=await input.invoke(name,JSON.parse(call.function?.arguments||'{}'));
   }catch(error){output={error:error instanceof Error?error.message:String(error)};}
   input.onCall?.({name,output});calls++;
   // Tool observations may contain local renderings. Send actual pixels to the
   // model in a multimodal message instead of burying base64 inside JSON text.
   const observation=output as {images?:unknown};
   const images=Array.isArray(observation?.images)?observation.images.filter((image):image is string=>typeof image==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)):[];
   const text=images.length?{...(output as object),images:undefined}:output;
   input.messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(text)});
   observations.push(...images);
   // A target may finish its own validated protocol. No extra model narration
   // is needed after the final review; a later call in the same batch invalidates it.
   const result=output as {readyToCommit?:boolean;summary?:string};
   readySummary=result?.readyToCommit===true?result.summary||'已准备修改':undefined;
   if(input.mode==='single-pass'&&!(output as {error?:unknown})?.error)return {summary:'已准备修改',calls};
  }
  if(readySummary!==undefined)return {summary:readySummary,calls};
  if(observations.length)input.messages.push({role:'user',content:[{type:'text',text:'这是本轮工具返回的实际候选预览（按工具调用顺序），请检查最新候选后再决定通过或修正。'},...observations.map(url=>({type:'image_url',image_url:{url}}))]});
 }
 throw new Error('这轮操作尚未完成，请缩小要求后重试。');
}
