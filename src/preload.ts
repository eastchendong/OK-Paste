import {contextBridge,ipcRenderer} from 'electron';import type {State,Action} from './types';import type {ClipboardSnapshot} from './clipboard/types';
contextBridge.exposeInMainWorld('okpaste',{
 send:(text:string)=>ipcRenderer.invoke('message',text),
 state:()=>ipcRenderer.invoke('state'),action:(action:Action)=>ipcRenderer.invoke('action',action),drag:()=>ipcRenderer.send('drag-reference'),
 subscribe:(fn:(s:State)=>void)=>{const handler=(_:unknown,s:State)=>fn(s);ipcRenderer.on('state',handler);return()=>ipcRenderer.removeListener('state',handler);},
 clipboard:()=>ipcRenderer.invoke('clipboard'),
 paste:(itemId:string,destinationId:string)=>ipcRenderer.invoke('clipboard-paste',itemId,destinationId),
 subscribeClipboard:(fn:(snapshot:ClipboardSnapshot)=>void)=>{const handler=(_:unknown,snapshot:ClipboardSnapshot)=>fn(snapshot);ipcRenderer.on('clipboard',handler);return()=>ipcRenderer.removeListener('clipboard',handler);}
});
