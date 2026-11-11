import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const disable=process.argv.includes('--disable');
const versionIndex=process.argv.indexOf('--version');
const resources='/Applications/Blender.app/Contents/Resources';
const versions=fs.existsSync(resources)?fs.readdirSync(resources).filter(name=>/^\d+\.\d+$/.test(name)):[];
const version=versionIndex>=0?process.argv[versionIndex+1]:versions.length===1?versions[0]:'';
if(!/^\d+\.\d+$/.test(version||''))throw new Error('无法确定 Blender 版本，请传入 --version 5.2 等已安装版本');
const homeIndex=process.argv.indexOf('--blender-user-dir');
const userDirectory=homeIndex>=0?process.argv[homeIndex+1]:path.join(os.homedir(),'Library/Application Support/Blender',version);
if(!userDirectory)throw new Error('--blender-user-dir 缺少路径');
const target=path.join(path.resolve(userDirectory),'scripts/startup/tuotie_autoconnect.py');
const marker='Tuotie managed startup bridge';
if(fs.existsSync(target)&&!fs.readFileSync(target,'utf8').includes(marker))throw new Error('目标文件不是妥帖管理的启动模块，未覆盖');
if(disable){
 fs.rmSync(target,{force:true});
 console.log('已关闭下次 Blender 启动时的自动连接；当前会话在 Blender 退出后生效。');
}else{
 const runtime=path.join(os.homedir(),'Library/Application Support/Tuotie/runtime');
 if(homeIndex<0&&!fs.existsSync(path.join(runtime,'.local/mcp-for-blender/addon.py')))throw new Error('请先运行 setup:mcp 和 prepare-desktop-runtime.mjs');
 fs.mkdirSync(path.dirname(target),{recursive:true});
 fs.copyFileSync(path.join(root,'blender/tuotie_autoconnect.py'),target);
 console.log('已启用 Blender 自动连接：'+target);
 console.log('Blender 打开后等待妥帖；连接当前工程，不打开或保存其他文件。');
}
