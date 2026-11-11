import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const localUv=path.join(os.homedir(),'.local/bin/uv');
const uv=fs.existsSync(localUv)?localUv:'uv';
for(const args of [['venv','--python','3.11',path.join(root,'.local/office-venv')],['pip','install','--python',path.join(root,'.local/office-venv/bin/python'),'-r',path.join(root,'requirements-office.txt')]]) {
 const result=spawnSync(uv,args,{cwd:root,stdio:'inherit'}); if(result.status!==0)process.exit(result.status??1);
}
console.log('Office 文件适配环境已准备好');
