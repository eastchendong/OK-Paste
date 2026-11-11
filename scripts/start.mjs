import fs from'node:fs';import path from'node:path';import{fileURLToPath}from'node:url';import{spawn}from'node:child_process';import net from'node:net';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function available(){return new Promise(resolve=>{const socket=net.connect({host:'127.0.0.1',port:9876});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));});}
if(!fs.existsSync(path.join(root,'dist/main.cjs')))throw Error('请先执行 pnpm build。');
if(!await available()){
 const log=fs.openSync(path.join(root,'.local/blender.log'),'a');
 const blender=spawn('/Applications/Blender.app/Contents/MacOS/Blender',['--python',path.join(root,'blender/start.py')],{cwd:root,stdio:['ignore',log,log],detached:true});blender.unref();
 let ready=false;for(let i=0;i<40;i++){if(await available()){ready=true;break;}await new Promise(r=>setTimeout(r,500));}
 if(!ready)throw Error('Blender 未能启动 MCP，请检查 .local/blender.log。');
}
const electron=spawn(process.execPath,[path.join(root,'node_modules/electron/cli.js'),'.'],{cwd:root,stdio:'inherit'});
electron.on('exit',code=>process.exit(code??0));
