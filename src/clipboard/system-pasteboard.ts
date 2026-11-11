import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {ClipboardItem} from './types';

const IMAGE_CLASS: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/gif': 'GIFf',
  'image/tiff': 'TIFF',
  'image/png': 'PNGf',
};

export function writeSystemPasteboard(item: ClipboardItem, bytes?: Buffer, filePath?: string) {
  if (process.platform !== 'darwin') throw new Error('当前系统没有可写入的剪贴板');
  if (item.type === 'text') {
    const text = typeof item.body.text === 'string' ? item.body.text : '';
    if (!text) throw new Error('没有可写入剪贴板的文字');
    copyText(text);
    return;
  }
  if (bytes?.length && item.type === 'image') {
    copyImage(bytes, typeof item.body.mime === 'string' ? item.body.mime : 'image/png');
    return;
  }
  if (filePath && fs.existsSync(filePath)) {
    copyFile(filePath);
    return;
  }
  const text = typeof item.body.text === 'string' ? item.body.text : '';
  const resource = typeof item.body.resourceUrl === 'string' ? item.body.resourceUrl : '';
  copyText(text || resource || item.type);
}

export function copyText(text: string) {
  const result = spawnSync('/usr/bin/pbcopy', [], {input: text});
  if (result.status !== 0) throw new Error('系统剪贴板没有写入');
}

function copyImage(bytes: Buffer, mime: string) {
  const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/gif' ? 'gif' : mime === 'image/webp' ? 'webp' : 'png';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'okpaste-'));
  const source = path.join(directory, `image.${extension}`);
  fs.writeFileSync(source, bytes);
  let png = source;
  try {
    if (mime !== 'image/png') {
      const converted = path.join(directory, 'image.png');
      const sips = spawnSync('/usr/bin/sips', ['-s', 'format', 'png', source, '--out', converted], {encoding: 'utf8'});
      if (sips.status !== 0 || !fs.existsSync(converted)) throw new Error(sips.stderr || '图片无法放入系统剪贴板');
      png = converted;
    }
    const script = `set the clipboard to (read (POSIX file ${quoted(png)}) as «class ${IMAGE_CLASS['image/png']}»)`;
    const result = spawnSync('/usr/bin/osascript', ['-e', script], {encoding: 'utf8'});
    if (result.status !== 0) throw new Error(result.stderr.trim() || '系统剪贴板没有写入图片');
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

function copyFile(filePath: string) {
  const script = `set the clipboard to (POSIX file ${quoted(filePath)})`;
  const result = spawnSync('/usr/bin/osascript', ['-e', script], {encoding: 'utf8'});
  if (result.status !== 0) copyText(filePath);
}

function quoted(file: string) {
  return `"${file.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
