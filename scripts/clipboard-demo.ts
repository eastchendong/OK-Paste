import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CLIPBOARD_PORT} from '../src/clipboard/port';
import {startDemoHost} from './demo-host';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = process.env.OKPASTE_CLIPBOARD_DIR || path.join(root, '.local', 'clipboard');
const port = Number(process.env.OKPASTE_CLIPBOARD_PORT || CLIPBOARD_PORT);
fs.mkdirSync(directory, {recursive: true});
const host = await startDemoHost({directory, port});
console.log(`浏览器复制演示：${host.url}`);
console.log(`剪贴板目录：${directory}`);
console.log('选中文字后点 Copy；Alt+C 进入 Magic Copy，再拖选或按住 Shift 圈选。');
const shutdown = () => { void host.close().finally(() => process.exit(0)); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
