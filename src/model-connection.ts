import fs from 'node:fs';
import path from 'node:path';
import {readAgentConfig} from './app-settings';

export const DEFAULT_MODEL_BASE = 'https://api.deepseek.com';
export const DEFAULT_MODEL = 'deepseek-flash';

function legacyRecommendationKey(root:string):string {
  try {const value=JSON.parse(fs.readFileSync(path.join(root,'.local/recommendations-config.json'),'utf8')).apiKey;return typeof value==='string'?value.trim():'';} catch {return '';}
}

export function modelConnection(root: string) {
  const config=readAgentConfig(root);
  const base=(config.OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? config.ARK_BASE_URL ?? DEFAULT_MODEL_BASE).trim().replace(/\/+$/,'').replace(/\/chat\/completions$/,'');
  const model=(config.OPENAI_MODEL ?? process.env.OPENAI_MODEL ?? config.ARK_MODEL ?? DEFAULT_MODEL).trim();
  let url:URL;
  try {url=new URL(base);} catch {throw new Error('请在妥帖设置中填写有效的 API Base URL。');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('API Base URL 请使用不含密钥或查询参数的 HTTP(S) 地址。');
  if(!model)throw new Error('请在妥帖设置中填写模型名称。');
  const deepseek=url.hostname==='api.deepseek.com';
  const key=config.OPENAI_API_KEY ?? process.env.OPENAI_API_KEY ?? (deepseek ? legacyRecommendationKey(root) : config.ARK_API_KEY ?? process.env.ARK_API_KEY ?? '');
  const ark=url.hostname==='ark.cn-beijing.volces.com';
  const arkPlan=ark&&url.pathname.startsWith('/api/plan/')&&model==='glm-5.3-flash';
  const openai=url.hostname==='api.openai.com'||/^(gpt-[5-9]|o[134])(?:[.-]|$)/.test(model);
  return {base,model,key,endpoint:base+'/chat/completions',ark,
    parameters:deepseek ? {max_tokens:8192,thinking:{type:'disabled'}} : arkPlan ? {max_tokens:8192,reasoning_effort:'low'} : openai ? {max_completion_tokens:8192} : {max_tokens:8192}};
}

// Provider reasoning fields remain available for Ark but never leak into a
// standard OpenAI request when switching service during an existing session.
export function chatMessages(messages:Record<string,any>[], ark:boolean) {
  return messages.map(({reasoning_content,...message})=>({
    ...message,
    // Provider responses may include stream-only fields such as index. They
    // are not request fields: replay only the standard function-call contract.
    ...(Array.isArray(message.tool_calls)?{tool_calls:message.tool_calls.map((call:any)=>({
      id:call.id,type:'function',function:{name:call.function?.name,arguments:call.function?.arguments}
    }))}:{}),
    ...(ark&&reasoning_content?{reasoning_content}:{})
  }));
}

/** Recommendations and fast execution share the main DeepSeek credential. */
export function deepseekApiKey(root:string):string {
  const connection=modelConnection(root);
  if(new URL(connection.base).hostname==='api.deepseek.com' && connection.model===DEFAULT_MODEL)return connection.key;
  return legacyRecommendationKey(root);
}
