import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {build} from 'esbuild';import {figmaConnection} from '../src/figma/bridge';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Optional legacy MCP sandbox only. Never overwrite the registered live plugin.
const directory=path.join(root,'.local/figma-mcp-plugin');fs.mkdirSync(directory,{recursive:true});
const manifestFile=path.join(directory,'manifest.json');
const registered=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile,'utf8')):{};
await build({entryPoints:[path.join(root,'figma/plugin/code.js')],outfile:path.join(directory,'code.js'),bundle:true,format:'iife',target:'es2017'});
const html=fs.readFileSync(path.join(root,'figma/plugin/ui.html'),'utf8').replace('__TUOTIE_TOKEN__',JSON.stringify(figmaConnection(root).token));
fs.writeFileSync(path.join(directory,'ui.html'),html,{mode:0o600});
fs.writeFileSync(manifestFile,JSON.stringify({...(typeof registered.id==='string'&&registered.id?{id:registered.id}:{}),name:'妥帖 MCP（实验）',api:'1.0.0',main:'code.js',ui:'ui.html',editorType:['figma'],documentAccess:'dynamic-page',networkAccess:{allowedDomains:['none'],devAllowedDomains:['http://localhost:47723']}},null,2));
console.log('Figma → Plugins → Development → Import plugin from manifest：\n'+path.join(directory,'manifest.json'));
