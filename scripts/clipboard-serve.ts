import {OfficeBridge} from '../src/office-live/bridge';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {CLIPBOARD_PORT} from '../src/clipboard/port';
import {ClipboardStore} from '../src/clipboard/store';
import {writeSystemPasteboard,copyText} from '../src/clipboard/system-pasteboard';
import {BlenderLink} from '../src/destinations/blender-link';
import {DestinationRegistry} from '../src/destinations/registry';
import {registerClipboardDestinations} from '../src/destinations/standard';
import {SceneRunner} from '../src/scene-runner';
import {DesktopAgent} from '../src/desktop-agent';
import {startDemoHost} from './demo-host';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = process.env.OKPASTE_CLIPBOARD_DIR || path.join(root, '.local', 'clipboard');
const port = Number(process.env.OKPASTE_CLIPBOARD_PORT || CLIPBOARD_PORT);
fs.mkdirSync(directory, {recursive: true});
const destinations = new DestinationRegistry();
const blender = new BlenderLink(root);
export const store = new ClipboardStore(directory);
const scenes = new SceneRunner(root, blender, store);
export const agent = new DesktopAgent(root, scenes, store,copyText);
const runtimeSessionId=crypto.randomUUID();
export const office=new OfficeBridge(root);
await office.start().catch(error=>console.error('Office 连接未启动：',error.message));
await agent.restoreTarget();
registerClipboardDestinations(destinations, 'later');
destinations.register(blender.destination());
destinations.register({id:'office',name:'目标文档',accepts:['*'],describe:()=>({connected:agent.files.selected,detail:agent.files.targetName}),paste(){throw new Error('请选择目标文件，再点推荐或输入要求生成预览');}});
void blender.connect();
setInterval(() => {
  void blender.connect();
  agent.ensurePlanned();
}, 2000);
const host = await startDemoHost({
  directory,
  port,
  destinations,
  store,
  onChange:()=>{void agent.ensurePlanned();},
  agent: {status:()=>({...agent.status(),runtimeSessionId}),preparePackDrag:()=>agent.preparePackDrag(),cancelNativeDrop:id=>agent.cancelNativeDrop(id),updateFocus:f=>agent.updateFocus(f),markAnchor:f=>agent.markAnchor(f),beginInputPaste:c=>agent.beginInputPaste(c),exchangeInput:(id,receipt)=>agent.exchangeInput(id,receipt),beginBlenderPaste:f=>agent.beginBlenderPaste(f),beginWordPaste:f=>agent.beginWordPaste(f,office),beginExcelPaste:f=>agent.beginExcelPaste(f,office),beginPowerPointPaste:f=>agent.beginPowerPointPaste(f,office),beginIllustratorPaste:f=>agent.beginIllustratorPaste(f,office),beginFigmaPaste:f=>agent.beginFigmaPaste(f,office),run:i=>agent.run(i),control:a=>agent.control(a),supplement:i=>agent.supplement(i),selectTarget:i=>agent.selectTarget(i),dismissDrop:i=>agent.dismissDrop(i)},
  pasteboard: (item, bytes, filePath) => writeSystemPasteboard(item, bytes, filePath),
});
console.log(`妥帖剪贴板：${host.url}`);
console.log(`保存目录：${directory}`);
console.log('选中文字后点 Magic Copy 保存参考；Start from here 标记后续参考将用于修改的位置。');
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  void agent.shutdown().finally(async () => {
    await office.close();
    await host.close();
    await blender.client.close().catch(() => {});
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
