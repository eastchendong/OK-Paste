/* CEP hosts this same-origin page; tokens never enter files in the extension. */
(async()=>{
 const status=document.getElementById('status'),cep=window.__adobe_cep__;
 if(!cep){status.textContent='请从 Illustrator 的「窗口 → 扩展 → 妥帖 · Illustrator」打开';return;}
 const host=(method,args={})=>new Promise((resolve,reject)=>{
  const code=`TuotieIllustrator.dispatch(${JSON.stringify(method)},${JSON.stringify(args)})`.replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  cep.evalScript(code,raw=>{try{const value=JSON.parse(raw);value.ok?resolve(value.result):reject(new Error(value.error));}catch(error){reject(error);}});
 });
 const api=async(path,body)=>{
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${window.TUOTIE_LOCAL.token}`},body:JSON.stringify(body)});
  if(response.status===403){location.reload();throw new Error('正在重新连接妥帖…');}
  const value=await response.json();if(!response.ok)throw new Error(value.error||'本机连接失败');return value;
 };
 let sessionId='';
 while(true){
  try{
   const info=await host('info');
   if(!sessionId)sessionId=(await api('/connect',{host:'illustrator',url:info.url})).sessionId;
   const {commands}=await api('/poll',{sessionId,url:info.url});status.textContent='已连接 · 激活目标画板后按 ⌥⌘V';
   for(const command of commands){
    let result,error;try{result=await host(command.method,command.args);}catch(e){error=e.message||String(e);}
    // Commands are consumed once; failed delivery never repeats a write.
    await api('/result',{sessionId,id:command.id,result,error});
   }
  }catch(error){status.textContent=error.message;sessionId='';}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
})();
