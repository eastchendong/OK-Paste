import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CLIPBOARD_PORT} from '../src/clipboard/port';
import {startDemoHost} from './demo-host';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'okpaste-browser-'));
const chromePort = 9333;
const host = await startDemoHost({directory, port: CLIPBOARD_PORT});
const chromeData = fs.mkdtempSync(path.join(os.tmpdir(), 'okpaste-chrome-'));
const chromeBinary = fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'google-chrome';
const chrome = spawn(chromeBinary, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  `--user-data-dir=${chromeData}`,
  `--remote-debugging-port=${chromePort}`, 'about:blank',
], {stdio: 'ignore'});

try {
  const page = await openPage(chromePort, host.url);
  const session = await connect(page.webSocketDebuggerUrl);
  await session.send('Runtime.enable');
  await session.evaluate(`
    async function waitFor(check) {
      const start = Date.now();
      while (Date.now() - start < 5000) {
        if (await check()) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('timed out');
    }
    await waitFor(() => document.querySelector('okpaste-copy'));
    const paragraph = document.querySelector('#paragraph');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, button: 0, clientX: 40, clientY: 80}));
    await waitFor(() => {
      const popup = document.querySelector('okpaste-copy').shadowRoot.querySelector('.popup');
      return popup && !popup.hidden && popup.querySelector('button.copy').textContent.trim() === '加入内容包';
    });
    document.querySelector('okpaste-copy').shadowRoot.querySelector('button.copy').click();
    await waitFor(async () => {
      const payload = await fetch('/v1/clipboard/items', {cache: 'no-store'}).then(response => response.json());
      return payload.items.some(item => item.type === 'text' && String(item.body.text).includes('把这段话选中'));
    });
  `);
  await session.evaluate('location.reload()');
  await until(session, `return !!document.querySelector('#items')?.textContent?.includes('把这段话选中')`);
  await session.evaluate(`
    async function waitFor(check) {
      const start = Date.now();
      while (Date.now() - start < 5000) {
        if (await check()) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('image was not stored');
    }
    await waitFor(() => document.querySelector('okpaste-copy'));
    document.querySelector('#picture').dispatchEvent(new MouseEvent('mouseup', {bubbles: true, button: 0, clientX: 30, clientY: 30}));
    await waitFor(() => {
      const popup = document.querySelector('okpaste-copy').shadowRoot.querySelector('.popup');
      return popup && !popup.hidden && popup.querySelector('button.copy').textContent.trim() === '加入内容包';
    });
    document.querySelector('okpaste-copy').shadowRoot.querySelector('button.copy').click();
    await waitFor(async () => {
      const payload = await fetch('/v1/clipboard/items', {cache: 'no-store'}).then(response => response.json());
      return payload.items.some(item => item.type === 'image');
    });
    const toolbar = document.querySelector('okpaste-copy').shadowRoot;
    if (toolbar.querySelectorAll('button').length !== 2 || !toolbar.textContent.includes('设为目标位置')) throw new Error('two-action toolbar missing');
    document.querySelector('#clip').dispatchEvent(new MouseEvent('mouseup', {bubbles: true, button: 0, clientX: 40, clientY: 80}));
    await waitFor(() => !toolbar.querySelector('.popup').hidden && !toolbar.querySelector('button.copy').disabled);
    toolbar.querySelector('button.copy').click();
    await waitFor(async () => {
      const payload = await fetch('/v1/clipboard/items', {cache: 'no-store'}).then(response => response.json());
      return payload.items.some(item => item.type === 'video');
    });
  `);
  session.close();
  await host.close();
  const read = spawnSync(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'scripts/clipboard-read.ts'), directory], {cwd: root, encoding: 'utf8'});
  if (read.status !== 0) throw new Error(read.stderr || read.stdout || 'fresh process could not read the clipboard');
  const items = JSON.parse(read.stdout) as {type: string; url: string; title: string; bytes: number}[];
  const text = items.find(item => item.type === 'text');
  const image = items.find(item => item.type === 'image');
  const video = items.find(item => item.type === 'video');
  if (!text?.url.includes('127.0.0.1') || text.title !== '妥帖 Copy 演示') throw new Error('text source was not stored');
  if (!image || image.bytes < 1) throw new Error('image bytes were not stored');
  if (!video?.url.includes('127.0.0.1')) throw new Error('video was not stored');
  console.log(JSON.stringify({ok: true, items: items.map(item => item.type)}));
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
} finally {
  chrome.kill('SIGKILL');
  await Promise.race([new Promise(resolve => chrome.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 1000))]);
  await host.close().catch(() => {});
  fs.rmSync(directory, {recursive: true, force: true});
  try { fs.rmSync(chromeData, {recursive: true, force: true, maxRetries: 3}); } catch { /* Chrome 退出时目录可能仍被占用 */ }
}

async function openPage(port: number, url: string) {
  const deadline = Date.now() + 10000;
  let version: {webSocketDebuggerUrl?: string} | undefined;
  while (Date.now() < deadline) {
    try {
      version = await fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json());
      if (version?.webSocketDebuggerUrl) break;
    } catch { /* chrome is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!version?.webSocketDebuggerUrl) throw new Error('Chrome 调试端口没有起来');
  await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {method: 'PUT'});
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()) as {type: string; url: string; webSocketDebuggerUrl: string}[];
  const page = pages.find(item => item.type === 'page' && item.url.startsWith(url));
  if (!page) throw new Error('没有打开演示页');
  return page;
}

async function until(session: ReturnType<typeof connect>, expression: string) {
  const deadline = Date.now() + 8000;
  let last = '重新打开页面后没有读到已保存的内容';
  while (Date.now() < deadline) {
    try {
      if (await session.evaluate(expression)) return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(last);
}

function connect(url: string) {
  const socket = new WebSocket(url);
  let id = 0;
  const pending = new Map<number, {resolve: (value: unknown) => void; reject: (error: Error) => void}>();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data)) as {id?: number; result?: unknown; error?: {message?: string}};
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id)!;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message || 'cdp error'));
    else waiter.resolve(message.result);
  });
  const ready = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('无法连接 Chrome')));
  });
  return {
    async send(method: string, params?: unknown) {
      await ready;
      const messageId = ++id;
      const result = new Promise((resolve, reject) => pending.set(messageId, {resolve, reject}));
      socket.send(JSON.stringify({id: messageId, method, params}));
      return result;
    },
    async evaluate(expression: string) {
      await ready;
      const result = await this.send('Runtime.evaluate', {expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true}) as {result?: {value?: unknown}; exceptionDetails?: {text?: string; exception?: {description?: string}}};
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || '页面脚本失败');
      return result.result?.value;
    },
    close() { socket.close(); },
  };
}
