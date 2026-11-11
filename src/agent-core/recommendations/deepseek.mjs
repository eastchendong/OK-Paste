import { RecommendationError } from './core.mjs';
export const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
export const DEEPSEEK_MODEL = 'deepseek-flash';
/** Transport only; one request, no retry or repair. Credentials never leave this adapter. */
export function deepseekComplete(apiKey, {fetchImpl=fetch,timeoutMs=20000}={}) {
  return async (messages, signal) => {
    if(!apiKey) throw new RecommendationError('not_configured');
    const combined=AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
    let response;
    try {
      response=await fetchImpl(DEEPSEEK_URL,{
        method:'POST',signal:combined,
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},
        body:JSON.stringify({model:DEEPSEEK_MODEL,messages,thinking:{type:'disabled'},
          response_format:{type:'json_object'},max_tokens:180,stream:false})
      });
      if(!response.ok) throw new RecommendationError(response.status===401?'unauthorized':response.status===429?'rate_limited':'provider_error');
      const data=await response.json();
      combined.throwIfAborted();
      if(data.choices?.[0]?.finish_reason !== 'stop' || typeof data.choices?.[0]?.message?.content !== 'string')
        throw new RecommendationError('invalid_response');
      return data.choices[0].message.content;
    } catch(error) {
      if(error instanceof RecommendationError) throw error;
      if(signal?.aborted) throw signal.reason;
      throw new RecommendationError(combined.aborted?'timeout':'provider_error');
    }
  };
}
