import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {syncComponentLibrary} from './sync-component-library.mjs';
import {validateDesktopInstallation} from './desktop-signing.mjs';

// The GUI and its children must never use a checkout in Desktop/Documents.
// Preparation runs from the developer's terminal, before the app is launched.
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const candidateApp=process.argv[2]?path.resolve(process.argv[2]):null;
if(candidateApp)for(const warning of validateDesktopInstallation({app:candidateApp}).warnings)console.log(warning);
syncComponentLibrary();
// Rebuild generated browser assets before copying them. A running host serves
// these files from disk; copying an old generated content.js keeps the old UI.
for(const [entry,outfile] of [['content-script.ts','content.js'],['background.ts','background.js']]){
 await build({entryPoints:[path.join(source,'src/browser',entry)],bundle:true,format:'iife',platform:'browser',target:'chrome120',outfile:path.join(source,'browser',outfile)});
}
const runtime=path.join(os.homedir(),'Library/Application Support/Tuotie/runtime');
const local=path.join(runtime,'.local');
fs.mkdirSync(local,{recursive:true});
const interfaceDirectory=path.join(runtime,'ui');fs.mkdirSync(interfaceDirectory,{recursive:true});
for(const [from,name] of [['components-preview.html','components-preview.html'],['companion-motion-preview.html','companion-motion-preview.html'],['desktop-preview/desktop-live.js','desktop-live.js'],['desktop-preview/desktop-overlay.js','desktop-overlay.js']]){
 fs.copyFileSync(path.join(source,from),path.join(interfaceDirectory,name));
}
fs.cpSync(path.join(source,'ui/assets'),path.join(interfaceDirectory,'assets'),{recursive:true,force:true});
for(const name of ['src','scripts','office-live','illustrator-live','figma-live','figma','blender','office','jianying','assets','browser','package.json','pnpm-lock.yaml','requirements-mcp.txt','requirements-office.txt','requirements-jianying.txt']) {
 fs.cpSync(path.join(source,name),path.join(runtime,name),{recursive:true,force:true,verbatimSymlinks:true});
}
// Product feedback is owned by the cross-app native desktop overlay. Remove
// the superseded, self-owned Blender drawing helper from earlier local builds.
fs.rmSync(path.join(runtime,'blender','result_feedback.py'),{force:true});
const lock=crypto.createHash('sha256').update(fs.readFileSync(path.join(source,'pnpm-lock.yaml'))).digest('hex');
const stamp=path.join(local,'desktop-node-lock');
if(!fs.existsSync(stamp)||fs.readFileSync(stamp,'utf8')!==lock||!fs.existsSync(path.join(runtime,'node_modules/tsx'))) {
 fs.cpSync(path.join(source,'node_modules'),path.join(runtime,'node_modules'),{recursive:true,force:true,verbatimSymlinks:true});
 fs.writeFileSync(stamp,lock);
}
// Personal configuration and collected content stay local, outside the app/zip.
for(const name of ['.env.local']) {
 const from=path.join(source,name),to=path.join(runtime,name);
 if(fs.existsSync(from)&&!fs.existsSync(to)){fs.copyFileSync(from,to);fs.chmodSync(to,0o600);}
}
const wordCertificates=path.join(source,'.local/office-live');
if(fs.existsSync(wordCertificates)) {
 fs.mkdirSync(path.join(local,'office-live'),{recursive:true});
 for(const name of ['localhost-key.pem','localhost-cert.pem'])if(fs.existsSync(path.join(wordCertificates,name))){const to=path.join(local,'office-live',name);fs.copyFileSync(path.join(wordCertificates,name),to);fs.chmodSync(to,0o600);}
}
const previousClipboard=path.join(source,'.local/clipboard'),clipboard=path.join(local,'clipboard');
if(fs.existsSync(previousClipboard)&&!fs.existsSync(clipboard))fs.cpSync(previousClipboard,clipboard,{recursive:true});
const addon=path.join(source,'.local/mcp-for-blender/addon.py');
if(fs.existsSync(addon)) {
 fs.mkdirSync(path.join(local,'mcp-for-blender'),{recursive:true});
 fs.copyFileSync(addon,path.join(local,'mcp-for-blender/addon.py'));
}
const localUv=path.join(os.homedir(),'.local/bin/uv'),uv=fs.existsSync(localUv)?localUv:'uv';
const environments=[['mcp-venv','requirements-mcp.txt'],['office-venv','requirements-office.txt']];
// Jianying is disabled in the product. Keep its optional developer setup out of
// application preparation; retaining old adapter sources does not enable it.
for(const [folder,requirements] of environments) {
 const python=path.join(local,folder,'bin/python');
 const version=crypto.createHash('sha256').update(fs.readFileSync(path.join(runtime,requirements))).digest('hex');
 const marker=path.join(local,folder+'-requirements');
 const prepared=path.join(source,'.local',folder);
 if(!fs.existsSync(marker)&&fs.existsSync(path.join(prepared,'bin/python'))){
  fs.rmSync(path.join(local,folder),{recursive:true,force:true});
  fs.cpSync(prepared,path.join(local,folder),{recursive:true,force:true,verbatimSymlinks:true});
  // Runtime launches Python explicitly; old virtualenv script shebangs are not used.
  fs.writeFileSync(marker,version);
 }
 if(!fs.existsSync(python))execFileSync(uv,['venv','--python','3.11',path.join(local,folder)],{stdio:'inherit'});
 if(!fs.existsSync(marker)||fs.readFileSync(marker,'utf8')!==version){
  const args=['pip','install','--python',python,'-r',path.join(runtime,requirements)];
  const cached=spawnSync(uv,['--offline',...args],{cwd:runtime,stdio:'inherit'});
  if(cached.status!==0)execFileSync(uv,args,{cwd:runtime,stdio:'inherit',timeout:180000});
  fs.writeFileSync(marker,version);
 }
}
if(candidateApp) {
 // Recheck immediately before copying in case another build changed the
 // candidate or installed app while the runtime resources were prepared.
 validateDesktopInstallation({app:candidateApp});
 const app=path.join(os.homedir(),'Applications/妥帖.app');
 fs.mkdirSync(path.dirname(app),{recursive:true});
 execFileSync('/usr/bin/ditto',['--norsrc','--noextattr','--noqtn',candidateApp,app]);
 console.log('演示入口：'+app);
}
console.log('应用运行目录：'+runtime);
