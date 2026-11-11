import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {transform} from 'esbuild';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'figma-live'),output=path.resolve(process.argv[2]||path.join(root,'.local/figma-live-plugin'));
const registered=path.join(output,'manifest.json');
if(!fs.existsSync(registered))throw new Error('请先在 Figma 的 Plugins → Development → New plugin 创建 Custom UI 插件，并保存到该目录；Figma 会分配真实插件 ID。');
const {id}=JSON.parse(fs.readFileSync(registered,'utf8'));
if(typeof id!=='string'||!id)throw new Error('缺少 Figma 分配的插件 ID，请先创建开发插件');
const manifest={...JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8')),id};
const code=['host.js','fixture.js','code.js'].map(name=>fs.readFileSync(path.join(source,name),'utf8')).join('\n');
fs.writeFileSync(path.join(output,'code.js'),(await transform(code,{target:'es2017',format:'iife'})).code);
fs.copyFileSync(path.join(source,'ui.html'),path.join(output,'ui.html'));
fs.writeFileSync(registered,JSON.stringify(manifest,null,2)+'\n');
console.log(`Figma 开发插件已更新：${output}`);
