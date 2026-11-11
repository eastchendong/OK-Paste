import {spawnSync} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const uv=fs.existsSync(path.join(os.homedir(),'.local/bin/uv'))?path.join(os.homedir(),'.local/bin/uv'):'uv';
const directory=path.join(root,'.local/jianying-venv');
for(const args of [['venv','--python','3.11',directory],['pip','install','--python',path.join(directory,'bin/python'),'-r',path.join(root,'requirements-jianying.txt')]]){
 const result=spawnSync(uv,args,{cwd:root,stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);
}
console.log('剪映 MCP 环境已准备好');
