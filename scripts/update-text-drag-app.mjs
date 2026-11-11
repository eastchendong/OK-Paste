import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {signDesktopApp,validateDesktopInstallation} from './desktop-signing.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const installed=path.join(os.homedir(),'Applications/妥帖.app');
const runtime=path.join(os.homedir(),'Library/Application Support/Tuotie/runtime');
const build=path.join(root,'desktop-preview/build');
// Deliberately exclude the unverified Blender transaction changes in this checkout.
export const patches=[
 ['src/targets/input-live.ts','src/targets/input-live.ts'],
 ['src/desktop-agent.ts','src/desktop-agent.ts'],
 ['src/clipboard/server.ts','src/clipboard/server.ts'],
 ['scripts/clipboard-serve.ts','scripts/clipboard-serve.ts'],
 ['desktop-preview/desktop-live.js','ui/desktop-live.js'],
];
const binary='Contents/MacOS/TuotieDesktopPreview';
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run=(command,args)=>execFileSync(command,args,{stdio:'inherit'});
export function safeToRestart(status){
 return ['idle','ready','error'].includes(status?.phase)&&!status.canUndo&&!status.mutationUncertain&&
  !status.pendingDrop&&!status.previewPath&&!status.previewImage&&!status.previewText&&!(status.revision>0);
}
async function status(){
 let response;
 try{response=await fetch('http://127.0.0.1:47721/v1/agent/status',{signal:AbortSignal.timeout(2000)});}
 catch(error){
  if(error.cause?.code==='EPERM')throw new Error('当前执行环境禁止访问妥帖本机服务（EPERM），未开始安装。请在本机终端运行同一安装命令。');
  throw new Error('无法连接妥帖，请先打开现有 App，再运行安装命令。');
 }
 if(!response.ok)throw new Error('无法核对当前任务，未更新 App。');
 return response.json();
}
const legacyRelease={name:'text-drag',files:patches,label:'长邮件和内容拖放'};
function manifest(release){
 const data=JSON.parse(fs.readFileSync(path.join(build,release.name+'-update.json'),'utf8'));
 if(!path.resolve(data.directory).startsWith(build+path.sep)||!path.basename(data.directory).startsWith(release.name+'-'))throw new Error('更新包路径无效。');
 if(!Array.isArray(data.files)||JSON.stringify(data.files.map(file=>file.target))!==JSON.stringify(release.files.map(([,target])=>target)))throw new Error('更新文件清单无效。');
 for(const file of data.files)if(sha(path.join(data.directory,'patches',file.target))!==file.sha256)throw new Error('更新文件已变动，请重新准备。');
 if(sha(path.join(data.directory,'Tuotie.app',binary))!==data.binarySHA256)throw new Error('原生更新文件已变动，请重新准备。');
 return data;
}
function protectedState(){
 const files=['.env.local','blender/agent_scene.py','src/scene-runner.ts','src/agent-controller.ts','src/types.ts'];
 const clipboard=path.join(runtime,'.local/clipboard');
 if(fs.existsSync(clipboard)){
  const visit=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
   const file=path.join(directory,entry.name);
   if(entry.isDirectory())visit(file);else if(entry.isFile())files.push(path.relative(runtime,file));
  }};visit(clipboard);
 }
 return Object.fromEntries(files.sort().filter(file=>fs.existsSync(path.join(runtime,file))).map(file=>[file,sha(path.join(runtime,file))]));
}
function hostProcesses(){
 const result=spawnSync('/bin/ps',['-axww','-o','pid=,command='],{encoding:'utf8'});
 if(result.status!==0)throw new Error('无法检查妥帖进程。');
 return result.stdout.split('\n').flatMap(line=>{
  const match=line.trim().match(/^(\d+)\s+(.+)$/);if(!match)return [];
  const command=match[2],pid=Number(match[1]);
  const host=path.join(installed,binary);
  const native=command===host||command.startsWith(host+' ');
  const sidecar=/^(?:[^\s]*\/)?node\s/.test(command)&&command.includes(path.join(runtime,'scripts/clipboard-serve.ts'));
  return native||sidecar?[pid]:[];
 });
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function stopHosts(){
 for(const pid of hostProcesses())try{process.kill(pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
 for(let attempt=0;attempt<40;attempt++){if(!hostProcesses().length)return;await delay(100);}
 throw new Error('妥帖未正常退出，未替换运行文件。');
}
async function prepare(release){
 if(!fs.existsSync(path.join(installed,binary)))throw new Error('未找到已安装的妥帖。');
 fs.mkdirSync(build,{recursive:true});const directory=fs.mkdtempSync(path.join(build,release.name+'-'));
 const app=path.join(directory,'Tuotie.app');
 run('/usr/bin/ditto',['--norsrc','--noextattr','--noqtn',installed,app]);
 const sources=path.join(root,'desktop-preview/Sources');
 const sdk='/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk';
 if(!fs.existsSync(sdk))throw new Error('本机原生构建 SDK 不存在。');
 run('/usr/bin/xcrun',['swiftc','-O','-sdk',sdk,'-target',`${process.arch==='arm64'?'arm64':'x86_64'}-apple-macosx13.0`,
  '-module-cache-path',path.join(directory,'module-cache'),'-framework','AppKit','-framework','WebKit','-framework','Carbon',
  ...fs.readdirSync(sources).filter(file=>file.endsWith('.swift')).map(file=>path.join(sources,file)),'-o',path.join(app,binary)]);
 const files=release.files.map(([source,target])=>{
  const file=path.join(directory,'patches',target);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(path.join(root,source),file);
  return {target,sha256:sha(file),baselineSHA256:fs.existsSync(path.join(runtime,target))?sha(path.join(runtime,target)):null};
 });
 fs.copyFileSync(path.join(root,'desktop-preview/desktop-live.js'),path.join(app,'Contents/Resources/desktop-live.js'));
 const data={directory,files,binarySHA256:sha(path.join(app,binary)),installedBinarySHA256:sha(path.join(installed,binary))};
 fs.writeFileSync(path.join(build,release.name+'-update.json'),JSON.stringify(data,null,2)+'\n');
 console.log(`已准备${release.label}更新；未签名、未安装、未重启日常 App。`);
}
async function install(release){
 const data=manifest(release),app=path.join(data.directory,'Tuotie.app');
 if(sha(path.join(installed,binary))!==data.installedBinarySHA256)throw new Error('日常 App 已被其他任务更新，请重新准备本修复。');
 for(const file of data.files)if((fs.existsSync(path.join(runtime,file.target))?sha(path.join(runtime,file.target)):null)!==file.baselineSHA256)throw new Error('运行代码已被其他任务更新，请重新准备本修复。');
 const initial=await status();
 if(!safeToRestart(initial))throw new Error('请先在妥帖处理并结束当前任务，再运行本命令；资料和当前 App 均未改动。');
 signDesktopApp({root,app,installedApp:installed});validateDesktopInstallation({app,installedApp:installed});
 if(!safeToRestart(await status()))throw new Error('签名期间开始了新任务，请结束后再更新；日常 App 未替换。');
 const before=protectedState();
 const backup=path.join(os.homedir(),'Library/Application Support/Tuotie/backups',`${release.name}-${Date.now()}`);
 fs.mkdirSync(backup,{recursive:true,mode:0o700});
 run('/usr/bin/ditto',['--norsrc','--noextattr','--noqtn',installed,path.join(backup,'Tuotie.app')]);
 for(const file of data.files)if(file.baselineSHA256){const out=path.join(backup,'runtime',file.target);fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(path.join(runtime,file.target),out);}
 await stopHosts();
 try{
  for(const file of data.files){const out=path.join(runtime,file.target);fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(path.join(data.directory,'patches',file.target),out);}
  run('/usr/bin/ditto',['--norsrc','--noextattr','--noqtn',app,installed]);
  validateDesktopInstallation({app:installed,installedApp:installed});
  if(JSON.stringify(protectedState())!==JSON.stringify(before))throw new Error('资料、配置或未纳入本次更新的模块发生变化。');
  run('/usr/bin/open',['-a',installed]);
  let ready=false;
  for(let attempt=0;attempt<40;attempt++){await delay(500);try{const latest=await status();if(latest.runtimeSessionId&&latest.runtimeSessionId!==initial.runtimeSessionId){ready=true;break;}}catch{}}
  if(!ready)throw new Error('新服务未在等待时间内就绪。');
  for(const file of data.files)if(sha(path.join(runtime,file.target))!==file.sha256)throw new Error('更新文件回读不一致。');
  console.log(`妥帖已更新并重新打开，${release.label}代码已同步；请用合成内容验证实际拖放。`);
 }catch(error){
  await stopHosts();
  for(const file of data.files){const out=path.join(runtime,file.target);if(file.baselineSHA256)fs.copyFileSync(path.join(backup,'runtime',file.target),out);else fs.rmSync(out,{force:true});}
  run('/usr/bin/ditto',['--norsrc','--noextattr','--noqtn',path.join(backup,'Tuotie.app'),installed]);run('/usr/bin/open',['-a',installed]);
  throw new Error('更新未完成，已恢复原 App 和本次涉及的运行文件：'+error.message);
 }
}
export async function runScopedDesktopUpdate(release,mode){
 if(!/^[a-z][a-z-]{1,40}$/.test(release.name)||!Array.isArray(release.files)||!release.files.length)throw new Error('更新清单无效。');
 for(const pair of release.files)if(pair.length!==2||pair.some(file=>typeof file!=='string'||path.isAbsolute(file)||file.split(/[\\/]/).includes('..')))throw new Error('更新文件路径无效。');
 if(mode==='--prepare')return prepare(release);
 if(mode==='--install')return install(release);
 throw new Error('请使用 --prepare 或 --install');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv[2]==='--prepare'){
   if(fs.readFileSync(path.join(root,'src/desktop-agent.ts'),'utf8').includes("from './native-drop'"))throw new Error('当前源码已增加跨应用拖放，请改用 update-native-drop-app.mjs --prepare，避免遗漏运行依赖。');
   await prepare(legacyRelease);
  }
  else if(process.argv[2]==='--install')await install(legacyRelease);
  else throw new Error('用法：node scripts/update-text-drag-app.mjs --prepare 或 --install');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
