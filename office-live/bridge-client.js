/* One serialized transport for live editors. Reconnects never replay edits. */
export function createBridgeClient({token,bootstrapPath,describe,execute,onStatus=()=>{},fetch:request=globalThis.fetch.bind(globalThis),requestTimeoutMs=8000}){
 let sessionId='',commands=[],pendingResult;
 async function post(path,body){
  const controller=new AbortController();let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new Error('本机连接超时，正在自动重连…'));controller.abort();},requestTimeoutMs);});
  try{return await Promise.race([timeout,(async()=>{
  const response=await request(path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),signal:controller.signal});
  if(response.status===403){
   // Refresh transport credentials without reloading the editor adapter or losing its anchors.
   const page=await request(bootstrapPath,{cache:'no-store',signal:controller.signal});
   if(!page.ok)throw new Error('本机服务暂不可用');
   const config=(await page.text()).match(/window\.TUOTIE_LOCAL\s*=\s*(\{[^<]*?\})\s*;/);
   const refreshed=config&&JSON.parse(config[1]);
   if(typeof refreshed?.token!=='string'||!refreshed.token)throw new Error('本机连接配置无效');
   token=refreshed.token;throw new Error('正在重新连接妥帖…');
  }
  const data=await response.json();
  if(!response.ok)throw Object.assign(new Error(data.error||'本机连接失败'),{status:response.status});
  return data;
  })()]);}finally{clearTimeout(timer);}
 }
 async function deliver(){if(pendingResult){await post('/result',pendingResult);pendingResult=undefined;}}
 async function pollOnce(){
  try{
   const info=await describe();
   if(!sessionId)sessionId=(await post('/connect',info)).sessionId;
   await deliver();
   if(!commands.length)commands=(await post('/poll',{sessionId,...info})).commands;
   while(commands.length){
    const command=commands.shift();let result,error,mutationStarted;
    try{
     if(command.expiresAt&&Date.now()>=command.expiresAt)throw Object.assign(new Error('请求已过期，未执行；请重新开始'),{mutationStarted:false});
     result=await execute(command.method,command.args);
    }catch(cause){error=[cause.message||String(cause),cause.debugInfo?.errorLocation].filter(Boolean).join(' · ');mutationStarted=cause.mutationStarted;}
    pendingResult={sessionId,id:command.id,result,error,mutationStarted};
    await deliver();
   }
   onStatus(info);return true;
  }catch(error){
   // A missing server session means the backend restarted. Drop its old commands;
   // document contents stay untouched and the next task must capture a fresh anchor.
   if(error.status===409){sessionId='';commands=[];pendingResult=undefined;}
   onStatus(undefined,error);return false;
  }
 }
 async function run(interval=350){while(true){const ok=await pollOnce();await new Promise(resolve=>setTimeout(resolve,ok?interval:1000));}}
 return {pollOnce,run};
}
