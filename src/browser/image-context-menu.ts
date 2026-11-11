import {CLIPBOARD_ITEMS_PATH, CLIPBOARD_ORIGIN} from '../clipboard/port';
import type {ClipboardDraft} from '../clipboard/types';

export const IMAGE_MENU_ID = 'tuotie-add-image';
export const IMAGE_MENU_TITLE = '添加图片到妥帖内容包';
const IMAGE_LIMIT = 6_000_000;

export interface ImageClick {
  menuItemId: string | number;
  mediaType?: string;
  srcUrl?: string;
  pageUrl?: string;
  frameUrl?: string;
  frameId?: number;
}
export interface ImageTab {id?: number; title?: string; url?: string}

// This package is installed in Chrome. The capture client owns provenance;
// native focus polling and page/window titles are unrelated to that identity.
export const CHROME_IMAGE_APPLICATION = Object.freeze({appName:'Google Chrome',bundleId:'com.google.Chrome'});
export interface ImageApplication {appName: string; bundleId: string}
interface PageImage {dataUrl?: string; alt?: string; url?: string; title?: string}
interface ScriptRequest {
  target: {tabId: number; frameIds: number[]};
  func: ((srcUrl: string) => Promise<PageImage>) | ((message: string) => void);
  args: [string];
}
export interface ImageMenuChrome {
  runtime: {
    lastError?: {message?: string};
    onInstalled: {addListener(listener: () => void): void};
    onStartup: {addListener(listener: () => void): void};
  };
  contextMenus: {
    remove(id: string, callback: () => void): void;
    create(properties: {id: string; title: string; contexts: ['image']; documentUrlPatterns: string[]}): void;
    onClicked: {addListener(listener: (info: ImageClick, tab?: ImageTab) => void): void};
  };
  scripting: {executeScript(request: ScriptRequest): Promise<{result?: PageImage}[]>};
  action: {
    setBadgeText(options: {tabId: number; text: string}): Promise<void>;
    setTitle(options: {tabId: number; title: string}): Promise<void>;
  };
}

// Serialized by Chrome into the clicked frame. Keep all dependencies inside it.
export async function readImageInPage(srcUrl: string): Promise<PageImage> {
  const image = [...document.images].find(element => (element.currentSrc || element.src) === srcUrl);
  const result: PageImage = {url: location.href, title: document.title, alt: image?.alt};
  try {
    const url = new URL(srcUrl, location.href);
    if (!['https:', 'http:', 'blob:', 'data:'].includes(url.protocol)) return result;
    const response = await fetch(url.href, {credentials: 'include', signal: AbortSignal.timeout(6000)});
    if (!response.ok) return result;
    const length = Number(response.headers.get('content-length'));
    if (length > 6_000_000) { await response.body?.cancel(); return result; }
    // Return only a complete, bounded response. The worker also checks its
    // signature: some image CDNs label actual WebP bytes as octet-stream.
    const reader = response.body?.getReader();
    if (!reader) return result;
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 6_000_000) { await reader.cancel(); return result; }
      chunks.push(value);
    }
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
    if (!size) return result;
    const blob = new Blob(chunks as BlobPart[], {type: mime});
    result.dataUrl = await new Promise<string>((resolve, reject) => {
      const file = new FileReader();
      file.onload = () => resolve(String(file.result));
      file.onerror = () => reject(file.error);
      file.readAsDataURL(blob);
    });
  } catch { /* Cross-origin images are retried by the extension worker. */ }
  return result;
}

function imageMime(contentType: string, prefix: Uint8Array): string | undefined {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (mime.startsWith('image/')) return mime;
  const starts = (signature: number[], offset = 0) => signature.every((byte, index) => prefix[offset + index] === byte);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || starts([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return 'image/gif';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
}

function pageImageDataUrl(value?: string): string | undefined {
  if (!value || value.length > 8_100_000) return;
  const match = /^data:([^;,]*);base64,([a-z\d+/=]+)$/i.exec(value);
  if (!match) return;
  try {
    const prefix = Uint8Array.from(atob(match[2].slice(0, 64)), character => character.charCodeAt(0));
    const mime = imageMime(match[1], prefix);
    if (mime) return `data:${mime};base64,${match[2]}`;
  } catch { /* An invalid page response falls back to the worker download. */ }
}

// A small result message; the browser's own context menu remains untouched.
export function showImageResult(message: string): void {
  document.querySelector('tuotie-image-result')?.remove();
  const host = document.createElement('tuotie-image-result');
  host.style.cssText = 'position:fixed;left:50%;bottom:25px;transform:translateX(-50%);z-index:2147483647;pointer-events:none';
  const root = host.attachShadow({mode: 'closed'});
  const note = document.createElement('div');
  note.setAttribute('role', 'status');
  // Match components-preview.html .toast.glass, within this isolated shadow.
  note.style.cssText = 'padding:10px 14px;max-width:min(340px,calc(100vw - 32px));border:.5px solid rgba(255,255,255,.7);border-radius:12px;background:rgba(255,255,255,.6);color:#113264;box-shadow:0 22px 55px #00002f26,0 3px 10px #0000330f,inset 0 .5px rgba(255,255,255,.9),inset 0 -1px rgba(255,255,255,.3);-webkit-backdrop-filter:blur(22px) saturate(1.35);backdrop-filter:blur(22px) saturate(1.35);font:12px/1.5 "PingFang SC","PingFang TC",sans-serif';
  note.textContent = message;
  root.append(note); document.documentElement.append(host);
  setTimeout(() => host.remove(), 4500);
}

export async function downloadContextImage(srcUrl: string): Promise<string> {
  const url = new URL(srcUrl);
  if (!['http:', 'https:', 'data:'].includes(url.protocol)) throw new Error('无法读取这张图片，请在原网页中重试');
  if (url.protocol === 'data:' && srcUrl.length > 8_100_000) throw new Error('图片超过 6 MB，暂时无法添加');
  const response = await fetch(srcUrl, {credentials: 'include', signal: AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error(`图片下载失败（HTTP ${response.status}）`);
  const length = Number(response.headers.get('content-length'));
  if (length > IMAGE_LIMIT) { await response.body?.cancel(); throw new Error('图片超过 6 MB，暂时无法添加'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('图片没有可保存的内容');
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > IMAGE_LIMIT) { await reader.cancel(); throw new Error('图片超过 6 MB，暂时无法添加'); }
    chunks.push(value);
  }
  if (!size) throw new Error('图片没有可保存的内容');
  const prefix = new Uint8Array(Math.min(size, 32));
  let filled = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, prefix.length - filled);
    prefix.set(slice, filled); filled += slice.length;
    if (filled === prefix.length) break;
  }
  const mime = imageMime(response.headers.get('content-type') || '', prefix);
  if (!mime) throw new Error('图片地址没有返回图片内容');
  let binary = '';
  for (const chunk of chunks) {
    for (let offset = 0; offset < chunk.length; offset += 0x8000) {
      binary += String.fromCharCode(...chunk.subarray(offset, offset + 0x8000));
    }
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export async function addContextImage(chrome: ImageMenuChrome, info: ImageClick, tab: ImageTab, application: ImageApplication = CHROME_IMAGE_APPLICATION): Promise<string> {
  if (info.menuItemId !== IMAGE_MENU_ID || info.mediaType !== 'image' || !info.srcUrl || tab.id == null) throw new Error('请在网页图片上使用这个菜单');
  // Fail before downloading a remote image if the desktop app is unavailable.
  try {
    const health = await fetch(`${CLIPBOARD_ORIGIN}/health`, {signal: AbortSignal.timeout(3000)});
    if (!health.ok) throw new Error();
  } catch { throw new Error('请先打开妥帖，再添加图片'); }
  let page: PageImage = {};
  const target = {tabId: tab.id, frameIds: [info.frameId ?? 0]};
  try {
    page = (await chrome.scripting.executeScript({target, func: readImageInPage, args: [info.srcUrl]}))[0]?.result ?? {};
  } catch { /* Older or restricted tabs can still use the clicked image URL. */ }
  let dataUrl = pageImageDataUrl(page.dataUrl);
  if (!dataUrl) dataUrl = await downloadContextImage(info.srcUrl);
  if (dataUrl.length > 8_100_000) throw new Error('图片超过 6 MB，暂时无法添加');
  // Inline images already carry their bytes once. Repeating a data URL in the
  // provenance and resource URL can triple the local request beyond its limit.
  const inlineSource = info.srcUrl.startsWith('data:');
  const draft: ClipboardDraft = {
    type: 'image',
    source: {...application, url: tab.url || info.pageUrl || page.url, title: tab.title || page.title, ...(!inlineSource ? {mediaUrl: info.srcUrl} : {}), captureMethod: 'image-context-menu', ...(info.frameUrl ? {frameUrl: info.frameUrl} : {})},
    body: {...(!inlineSource ? {resourceUrl: info.srcUrl} : {}), dataUrl, ...(page.alt ? {alt: page.alt} : {})},
  };
  let response: Response;
  try {
    response = await fetch(`${CLIPBOARD_ORIGIN}${CLIPBOARD_ITEMS_PATH}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(draft), signal: AbortSignal.timeout(6000)});
  } catch { throw new Error('妥帖连接中断，图片未确认保存，请查看内容包'); }
  const saved = await response.json().catch(() => ({})) as {error?: string; item?: {body?: {hasContent?: boolean}}; pasteboardError?: string};
  if (!response.ok) throw new Error(saved.error || '图片没有添加成功');
  if (!saved.item?.body?.hasContent) throw new Error('图片内容未能保存，请重试');
  // A saved item must not be reported as failed merely because macOS copy failed.
  return saved.pasteboardError ? '图片已添加到内容包，系统剪贴板未更新' : '图片已添加到妥帖内容包';
}

export function installImageContextMenu(chrome: ImageMenuChrome, application: ImageApplication = CHROME_IMAGE_APPLICATION): void {
  const register = () => chrome.contextMenus.remove(IMAGE_MENU_ID, () => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create({id: IMAGE_MENU_ID, title: IMAGE_MENU_TITLE, contexts: ['image'], documentUrlPatterns: ['http://*/*', 'https://*/*']});
  });
  chrome.runtime.onInstalled.addListener(register);
  chrome.runtime.onStartup.addListener(register);
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== IMAGE_MENU_ID || info.mediaType !== 'image' || tab?.id == null) return;
    const target = {tabId: tab.id, frameIds: [info.frameId ?? 0]};
    const badge = (text: string, title: string) => {
      void chrome.action.setBadgeText({tabId: tab.id!, text}).catch(() => {});
      void chrome.action.setTitle({tabId: tab.id!, title}).catch(() => {});
    };
    badge('…', '正在添加图片到妥帖');
    void addContextImage(chrome, info, tab, application).then(message => {
      badge('✓', message);
      void chrome.scripting.executeScript({target, func: showImageResult, args: [message]}).catch(() => {});
    }).catch(error => {
      const message = error instanceof Error ? error.message : '图片添加失败，请重试';
      badge('!', message);
      void chrome.scripting.executeScript({target, func: showImageResult, args: [message]}).catch(() => {});
    });
  });
}
