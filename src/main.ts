import {app,BrowserWindow,ipcMain,globalShortcut,Menu,nativeImage,screen,Tray} from 'electron';
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
import {AgentController as TaskController} from './agent-controller';import type {Action,State} from './types';
import {ClipboardHost} from './clipboard/host';import {writeSystemPasteboard} from './clipboard/system-pasteboard';
import {createBlenderDestination} from './destinations/blender';import {registerClipboardDestinations} from './destinations/standard';
import {startBlenderBridge, type BlenderBridge} from './destinations/blender-bridge';
app.setName('妥帖');const root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(root,'.local'),{recursive:true});
app.setPath('userData',path.join(app.getPath('appData'),'ok-paste-prototype'));
if(!app.requestSingleInstanceLock())app.exit(0);
app.on('second-instance',()=>{if(window&&!window.isDestroyed())show();});
let window:BrowserWindow;let controller:TaskController;let tray:Tray;let closing=false;let bridge:BlenderBridge|undefined;
const clipboardDir=path.join(root,'.local','clipboard');
const clipboardHost=new ClipboardHost(clipboardDir, writeSystemPasteboard);
const actions:Action[]=['toggle','capture','screenshot','retry','preview','commit','cancel','undo','show'];
function show(){window.show();window.focus();}
function publish(state:State){
 if(!window||window.isDestroyed())return;
 const isPanel=['analyzing','intent','preparing','preview','committing','error','done','answer'].includes(state.stage);
 const count=clipboardHost.store.list().length;
 const height=isPanel?760:state.active?(count?640:520):(count?560:420),width=isPanel?520:360;
 if(window.getBounds().height!==height){const area=screen.getPrimaryDisplay().workArea;window.setBounds({x:area.x+24,y:area.y+area.height-height-24,width,height});}
 fs.writeFileSync(path.join(root,'.local/window.json'),JSON.stringify({bounds:window.getBounds(),display:screen.getPrimaryDisplay().bounds,scaleFactor:screen.getPrimaryDisplay().scaleFactor}));
 window.webContents.send('state',state);tray?.setTitle(state.active?'妥帖 •':'妥帖');
 if(state.active&&!window.isVisible())window.showInactive();
 if(state.stage==='analyzing')show();
}
async function publishClipboard(){if(!window||window.isDestroyed())return;window.webContents.send('clipboard',await clipboardHost.snapshot());}
app.whenReady().then(async()=>{
 clipboardHost.setOnChange(()=>{void publishClipboard();if(controller)publish(controller.state);});
 registerClipboardDestinations(clipboardHost.destinations,'later');
 const ownsClipboard=await clipboardHost.start();
 ipcMain.handle('clipboard',()=>clipboardHost.snapshot());
 ipcMain.handle('clipboard-paste',async(_,itemId:unknown,destinationId:unknown)=>{if(typeof itemId!=='string'||typeof destinationId!=='string')throw Error('粘贴参数无效');await clipboardHost.paste(itemId,destinationId);});
 window=new BrowserWindow({width:360,height:420,x:24,y:400,title:'妥帖 · OK Paste',alwaysOnTop:true,resizable:false,show:false,backgroundColor:'#f8fafc',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 window.on('close',e=>{if(!closing){e.preventDefault();window.hide();}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
 await window.loadFile(path.join(__dirname,'ui/index.html'));
 tray=new Tray(nativeImage.createFromPath(path.join(root,'assets/models/apple-render.png')).resize({width:20,height:20}));
 tray.setTitle('妥帖');tray.setContextMenu(Menu.buildFromTemplate([{label:'显示妥帖',click:show},{label:'进入 / 退出 AI 模式',click:()=>void controller.action('toggle')},{label:'退出妥帖',click:()=>app.quit()}]));
 try{controller=new TaskController(root,publish);if(ownsClipboard)clipboardHost.destinations.register(createBlenderDestination(controller));}catch(e){window.webContents.send('fatal',String(e));show();return;}
 try{bridge=await startBlenderBridge({directory:clipboardDir,target:controller});}catch(e){console.error('Blender 粘贴桥没有启动',e);}
 ipcMain.handle('state',()=>controller.state);
 ipcMain.handle('message',async(_,text:unknown)=>{if(typeof text!=='string'||text.length>4000)throw Error('消息长度无效');await controller.send(text);});
 ipcMain.handle('action',async(_,action:Action)=>{
  if(!actions.includes(action))throw Error('未知操作');
  if(action==='show'){show();return;}
  if(action==='screenshot'){
   if(!controller.state.active)return;
   window.hide();const child=spawn('/usr/sbin/screencapture',['-i','-c']);child.once('exit',()=>window.showInactive());return;
  }
  await controller.action(action);
 });
 ipcMain.on('drag-reference',event=>{
  fs.appendFileSync(path.join(root,'.local/drag.log'),JSON.stringify({at:new Date().toISOString(),stage:controller.state.stage,active:controller.state.active})+'\n');
  if(event.sender!==window.webContents||!controller.state.active||!controller.state.source||controller.state.busy||!['collected'].includes(controller.state.stage))return;
  event.sender.startDrag({file:path.join(root,'.local/reference.png'),icon:nativeImage.createFromDataURL(controller.state.source).resize({width:90,height:90})});
 });
 let debounce:NodeJS.Timeout;
 fs.watch(path.join(root,'.local'),(_,filename)=>{
  if(filename!=='drop-event.json')return;clearTimeout(debounce);
  debounce=setTimeout(()=>{try{const data=JSON.parse(fs.readFileSync(path.join(root,'.local/drop-event.json'),'utf8'));void controller.drop(data);}catch(e){controller.update({error:'无法读取落点，请重新拖放。'});}},100);
 });
 try{controller.lastDrop=JSON.parse(fs.readFileSync(path.join(root,'.local/drop-event.json'),'utf8')).eventId;}catch{}
 controller.state.shortcut=globalShortcut.register('CommandOrControl+Shift+Space',()=>void controller.action('toggle'));
 setInterval(()=>{void publishClipboard();},1000);void publishClipboard();
 setInterval(()=>void controller.poll().catch(e=>controller.update({error:String(e)})),300);
 show();try{await controller.connect();if(process.argv.includes('--resume-capture')&&fs.existsSync(path.join(root,'.local/reference.png'))){const saved=fs.readFileSync(path.join(root,'.local/reference.png'));await controller.mode(true);controller.acceptImage(saved,'已恢复本次收集的参考图片');}}catch(e){controller.update({stage:'error',error:'Blender 未连接。请先运行 pnpm blender，再重新启动妥帖。'});}
});
app.on('activate',()=>window&&show());
let shuttingDown=false;
app.on('before-quit',event=>{
 closing=true;globalShortcut.unregisterAll();
 if(controller?.client.connected&&!shuttingDown){event.preventDefault();shuttingDown=true;void controller.action('cancel').catch(()=>{}).finally(async()=>{await controller.client.close();await bridge?.close();await clipboardHost.close();app.quit();});return;}
 void bridge?.close();void clipboardHost.close();
});
