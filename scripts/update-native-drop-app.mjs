import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {runScopedDesktopUpdate} from './update-text-drag-app.mjs';

// Selective deployment deliberately leaves unverified Blender transactions out.
export const patches=[
 'src/app-context.ts','src/native-drop.ts','src/targets/input-live.ts','src/desktop-agent.ts',
 'src/clipboard/server.ts','scripts/clipboard-serve.ts','office-live/excel-adapter.js',
 'figma-live/host.js'
].map(file=>[file,file]).concat([['desktop-preview/desktop-live.js','ui/desktop-live.js']]);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const release={name:'native-drop',files:patches,label:'Office、Figma 与通用应用原生拖放'};
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  await runScopedDesktopUpdate(release,process.argv[2]);
  if(process.argv[2]==='--install'){
   const plugin=path.join(os.homedir(),'figma-live-plugin');
   if(fs.existsSync(path.join(plugin,'manifest.json'))){
    // Retain the registered ID and a recoverable code backup. Running plugins
    // must be restarted in Figma by the user; never close an active transaction.
    const code=path.join(plugin,'code.js');if(fs.existsSync(code))fs.copyFileSync(code,code+'.before-native-drop');
    execFileSync(process.execPath,[path.join(root,'scripts/prepare-figma-plugin.mjs'),plugin],{stdio:'inherit'});
    console.log('Figma 插件已保留原 ID 更新；请结束旧任务后重新运行一次「连接妥帖」。');
   }else console.log('尚未找到既有 Figma 插件目录；Office 和通用入口已更新，Figma 需先安装并运行妥帖插件。');
  }
 }catch(error){console.error(error.message);process.exitCode=1;}
}
