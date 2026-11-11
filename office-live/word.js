import {createWordAdapter} from './word-adapter.js?v=10';
import {createBridgeClient} from './bridge-client.js';
const status=document.getElementById('status');
Office.onReady(async info=>{
 if(info.host!==Office.HostType.Word||!Office.context.requirements.isSetSupported('WordApi','1.3')){status.textContent='需要支持 WordApi 1.3 的 Microsoft Word';return;}
 const execute=createWordAdapter(Word);
 const documentURL=()=>new Promise(resolve=>Office.context.document.getFilePropertiesAsync(result=>resolve(result.status===Office.AsyncResultStatus.Succeeded?result.value.url:'')));
 await createBridgeClient({token:window.TUOTIE_LOCAL.token,bootstrapPath:'/word.html',execute,describe:async()=>({host:'word',url:await documentURL()}),onStatus:(_info,error)=>{status.textContent=error?.message||'已连接 · 回到正文按 ⌥⌘V';}}).run();
});
