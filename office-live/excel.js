import {createExcelAdapter} from './excel-adapter.js?v=3';
import {createBridgeClient} from './bridge-client.js';
const status=document.getElementById('status');
Office.onReady(async info=>{
 if(info.host!==Office.HostType.Excel||!Office.context.requirements.isSetSupported('ExcelApi','1.13')){status.textContent='需要支持 ExcelApi 1.13 的 Microsoft Excel，以检查合并和数组区域';return;}
 const execute=createExcelAdapter(Excel);
 const documentURL=()=>new Promise(resolve=>Office.context.document.getFilePropertiesAsync(result=>resolve(result.status===Office.AsyncResultStatus.Succeeded?result.value.url:'')));
 let url='';
 await createBridgeClient({token:window.TUOTIE_LOCAL.token,bootstrapPath:'/excel.html',execute:(method,args)=>execute(method,{...args,documentUrl:url}),describe:async()=>({host:'excel',url:url=await documentURL()}),onStatus:(_info,error)=>{status.textContent=error?.message||'已连接 · 选择单元格后按 ⌥⌘V';}}).run();
});
