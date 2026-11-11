import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [path.join(root, 'src/browser/image-background.ts')],
  bundle: true, format: 'iife', platform: 'browser', target: 'chrome120',
  outfile: path.join(root, 'browser-image/background.js'),
});
const directory = path.join(os.homedir(), 'Library/Application Support/Tuotie/extensions/image-menu');
fs.mkdirSync(directory, {recursive: true});
for (const name of ['manifest.json', 'background.js', 'icon16.png']) {
  fs.copyFileSync(path.join(root, 'browser-image', name), path.join(directory, name));
}
console.log('图片右键扩展已构建，Chrome 加载目录：' + directory);
