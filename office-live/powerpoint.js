import {createPowerPointAdapter} from './powerpoint-adapter.js?v=4';
import {createBridgeClient} from './bridge-client.js';
const status = document.getElementById('status');
Office.onReady(async info => {
  if (info.host !== Office.HostType.PowerPoint || !Office.context.requirements.isSetSupported('PowerPointApi', '1.10')) {
    const supported = ['1.1', '1.6', '1.8', '1.10'].filter(version => Office.context.requirements.isSetSupported('PowerPointApi', version));
    status.textContent = `当前 PowerPoint 未提供所需接口 1.10（可用：${supported.join('、') || '无'}）。请使用支持该接口的 Microsoft 365 PowerPoint；此时不会读取或修改文稿。`;
    return;
  }
  const execute = createPowerPointAdapter(PowerPoint, Office);
  const documentURL = () => new Promise(resolve => Office.context.document.getFilePropertiesAsync(result => resolve(result.status === Office.AsyncResultStatus.Succeeded ? result.value.url : '')));
  await createBridgeClient({token:window.TUOTIE_LOCAL.token,bootstrapPath:'/powerpoint.html',execute,describe:async()=>({host:'powerpoint',url:await documentURL()}),onStatus:(_info,error)=>{status.textContent=error?.message||'已连接 · 点击当前页按 ⌥⌘V 查看推荐；选中对象可沿用原编辑流程';}}).run();
});
