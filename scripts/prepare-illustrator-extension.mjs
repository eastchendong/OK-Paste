import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const install=process.argv.includes('--install');
const target=install?path.join(os.homedir(),'Library/Application Support/Adobe/CEP/extensions/cn.tuotie.illustrator'):path.join(root,'.local/illustrator-extension');
for(const name of ['CSXS/manifest.xml','index.html','illustrator-host.jsx']){
 const to=path.join(target,name);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(root,'illustrator-live',name),to);
}
console.log((install?'已安装本地扩展：':'已准备待检查扩展：')+target);
console.log('此脚本不修改 CEP 开发模式、证书信任或用户文档。');
