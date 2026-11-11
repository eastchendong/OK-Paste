import {createBridgeClient} from '/bridge-client.js';
(async()=>{
 const status=document.getElementById('status'),pending=new Map();let serial=0;
 window.addEventListener('message',event=>{if(event.source!==parent||event.data.type!=='host-result')return;const callback=pending.get(event.data.id);if(callback){pending.delete(event.data.id);clearTimeout(callback.timer);event.data.error?callback.reject(Object.assign(new Error(event.data.error),typeof event.data.mutationStarted==='boolean'?{mutationStarted:event.data.mutationStarted}:{})):callback.resolve(event.data.result);}});
 const host=(method,args={})=>new Promise((resolve,reject)=>{const id=`host-${++serial}`,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Figma 没有及时响应'));},29000);pending.set(id,{resolve,reject,timer});parent.postMessage({type:'host-command',id,method,args},'*');});
 const heartbeat=()=>parent.postMessage({type:'bridge-heartbeat'},'*');heartbeat();setInterval(heartbeat,1000);
 await createBridgeClient({token:window.TUOTIE_LOCAL.token,bootstrapPath:'/figma.html',execute:host,describe:async()=>({host:'figma',...await host('info')}),onStatus:(info,error)=>{status.textContent=error?'连接中断，正在自动重连…':`已连接 · ${info.documentName}`;status.title=error?.message||'';}}).run(500);
})();
