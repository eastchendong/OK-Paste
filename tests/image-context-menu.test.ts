import {afterEach, describe, expect, it, vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ClipboardStore} from '../src/clipboard/store';
import {addContextImage, downloadContextImage, IMAGE_MENU_ID, IMAGE_MENU_TITLE, installImageContextMenu, type ImageMenuChrome} from '../src/browser/image-context-menu';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const DATA = 'data:image/png;base64,' + PNG.toString('base64');
const WEBP = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==', 'base64');
const info = {menuItemId: IMAGE_MENU_ID, mediaType: 'image', srcUrl: 'https://cdn.example/image.png', pageUrl: 'https://article.example/post', frameId: 7, frameUrl: 'https://embed.example/frame'};
const tab = {id: 42, title: '真实文章', url: 'https://article.example/post'};
const directories: string[] = [];
afterEach(() => {vi.unstubAllGlobals(); directories.splice(0).forEach(folder => fs.rmSync(folder, {recursive: true, force: true}));});
function chromeMock() {
  const events: {installed?: () => void; startup?: () => void; click?: (info: any, tab?: any) => void} = {};
  const chrome: ImageMenuChrome = {
    runtime: {onInstalled: {addListener: listener => {events.installed = listener;}}, onStartup: {addListener: listener => {events.startup = listener;}}},
    contextMenus: {remove: vi.fn((_id, callback) => callback()), create: vi.fn(), onClicked: {addListener: listener => {events.click = listener;}}},
    scripting: {executeScript: vi.fn(async () => [{result: {dataUrl: DATA, alt: '原图说明'}}])},
    action: {setBadgeText: vi.fn(async () => {}), setTitle: vi.fn(async () => {})},
  };
  return {chrome, events};
}
function savedResponse(warning?: string) {return Response.json({item: {id: 'saved-image', body: {hasContent: true}}, ...(warning ? {pasteboardError: warning} : {})}, {status: 201});}

describe('native browser image context menu', () => {
  it('uses the capture client identity without querying foreground state or matching window titles', async () => {
    const {chrome}=chromeMock();let draft:any;
    const fetcher=vi.fn(async (url:string,init?:RequestInit)=>{
      if(url.endsWith('/health'))return Response.json({ok:true});
      if(url.endsWith('/v1/agent/status'))throw Error('Foreground polling must not be used');
      draft=JSON.parse(String(init?.body));return savedResponse();
    });
    vi.stubGlobal('fetch',fetcher);
    await addContextImage(chrome,info,{...tab,title:'收藏到 ARTSY'});
    expect(draft.source).toMatchObject({appName:'Google Chrome',bundleId:'com.google.Chrome'});
    expect(fetcher.mock.calls.some(([url])=>url.endsWith('/v1/agent/status'))).toBe(false);
    const edge={appName:'Microsoft Edge',bundleId:'com.microsoft.edgemac'};
    await addContextImage(chrome,info,{id:42},edge);
    expect(draft.source).toMatchObject(edge);
  });
  it('registers one image-only menu and ignores unrelated clicks', () => {
    const {chrome, events} = chromeMock();
    installImageContextMenu(chrome); events.installed!(); events.startup!();
    expect(chrome.contextMenus.create).toHaveBeenLastCalledWith({id: IMAGE_MENU_ID, title: IMAGE_MENU_TITLE, contexts: ['image'], documentUrlPatterns: ['http://*/*', 'https://*/*']});
    events.click!({...info, menuItemId: 'other'}, tab);
    events.click!({...info, mediaType: 'video'}, tab);
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(chrome.action.setBadgeText).not.toHaveBeenCalled();
  });

  it('saves real image bytes, alt and page/frame provenance and survives reopening', async () => {
    const {chrome} = chromeMock();
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tuotie-context-image-')); directories.push(folder);
    const store = new ClipboardStore(folder);
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/health')) return Response.json({ok: true});
      const draft = JSON.parse(String(init?.body));
      const item = store.add(draft);
      return Response.json({item: store.toPublic(item)}, {status: 201});
    }));
    expect(await addContextImage(chrome, info, tab)).toBe('图片已添加到妥帖内容包');
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({target: {tabId: 42, frameIds: [7]}, args: [info.srcUrl]}));
    const reopened = new ClipboardStore(folder), item = reopened.list()[0];
    expect(item.source).toMatchObject({appName:'Google Chrome',bundleId:'com.google.Chrome',url: tab.url, title: tab.title, mediaUrl: info.srcUrl, frameUrl: info.frameUrl, captureMethod: 'image-context-menu'});
    expect(item.body.alt).toBe('原图说明');
    expect(reopened.readContent(item.id)).toEqual(PNG);
    expect(reopened.toPublic(item).preview).toBe(DATA);
  });

  it('falls back to a worker download for cross-origin images unavailable to the page', async () => {
    const {chrome} = chromeMock();
    vi.mocked(chrome.scripting.executeScript).mockRejectedValue(new Error('No page access'));
    let draft: any;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/health')) return Response.json({ok: true});
      if (url === info.srcUrl) return new Response(PNG, {headers: {'content-type': 'image/png'}});
      draft = JSON.parse(String(init?.body)); return savedResponse();
    });
    vi.stubGlobal('fetch', fetcher);
    await addContextImage(chrome, info, tab);
    expect(fetcher).toHaveBeenCalledWith(info.srcUrl, expect.objectContaining({credentials: 'include'}));
    expect(draft.body.dataUrl).toBe(DATA);
  });

  it('uses a page-provided blob image without trying to fetch its URL from the worker', async () => {
    const {chrome} = chromeMock();
    const fetcher = vi.fn(async (url: string) => url.endsWith('/health') ? Response.json({ok: true}) : savedResponse());
    vi.stubGlobal('fetch', fetcher);
    await addContextImage(chrome, {...info, srcUrl: 'blob:https://article.example/image-id'}, tab);
    expect(fetcher.mock.calls.some(([url]) => url.startsWith('blob:'))).toBe(false);
  });

  it('saves page-provided binary responses as images when their actual signature matches', async () => {
    const {chrome} = chromeMock(); let draft: any;
    vi.mocked(chrome.scripting.executeScript).mockResolvedValue([{result: {dataUrl: 'data:application/octet-stream;base64,' + WEBP.toString('base64')}}]);
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/health')) return Response.json({ok: true});
      draft = JSON.parse(String(init?.body)); return savedResponse();
    });
    vi.stubGlobal('fetch', fetcher);
    await addContextImage(chrome, info, tab);
    expect(draft.body.dataUrl).toBe('data:image/webp;base64,' + WEBP.toString('base64'));
    expect(fetcher.mock.calls.some(([url]) => url === info.srcUrl)).toBe(false);
  });

  it('recognizes image signatures across download chunks despite missing or generic MIME headers', async () => {
    for (const [bytes, mime] of [[WEBP, 'image/webp'], [PNG, 'image/png']] as const) {
      for (const header of ['application/octet-stream', '']) {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({start(controller) {
          controller.enqueue(bytes.subarray(0, 3)); controller.enqueue(bytes.subarray(3)); controller.close();
        }}), {headers: header ? {'content-type': header} : {}})));
        expect(await downloadContextImage(info.srcUrl)).toBe(`data:${mime};base64,${bytes.toString('base64')}`);
      }
    }
  });

  it('rejects HTML and unknown binary bytes even when the URL looks like a WebP image', async () => {
    for (const content of ['<html>Access denied</html>', 'not an image']) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(content, {headers: {'content-type': 'application/octet-stream'}})));
      await expect(downloadContextImage('https://cdn.example/sign.webp')).rejects.toThrow('没有返回图片内容');
    }
  });

  it('does not multiply inline image bytes in the local request', async () => {
    const {chrome} = chromeMock(); let draft: any;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/health')) return Response.json({ok: true});
      draft = JSON.parse(String(init?.body)); return savedResponse();
    }));
    await addContextImage(chrome, {...info, srcUrl: DATA}, tab);
    expect(draft.body.dataUrl).toBe(DATA);
    expect(draft.body.resourceUrl).toBeUndefined();
    expect(draft.source.mediaUrl).toBeUndefined();
  });

  it('stops before reading image data if the desktop app is not running', async () => {
    const {chrome} = chromeMock();
    vi.stubGlobal('fetch', vi.fn(async () => {throw new TypeError('network');}));
    await expect(addContextImage(chrome, info, tab)).rejects.toThrow('请先打开妥帖');
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('does not report URL-only records as a successful image save', async () => {
    const {chrome} = chromeMock();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/health') ? Response.json({ok: true}) : Response.json({item: {body: {hasContent: false}}}, {status: 201})));
    await expect(addContextImage(chrome, info, tab)).rejects.toThrow('图片内容未能保存');
  });

  it('reports a saved image distinctly from failure to write the system clipboard', async () => {
    const {chrome} = chromeMock();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/health') ? Response.json({ok: true}) : savedResponse('unsupported clipboard format')));
    expect(await addContextImage(chrome, info, tab)).toBe('图片已添加到内容包，系统剪贴板未更新');
  });

  it('rejects nonimages and oversized streaming downloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>login</html>', {headers: {'content-type': 'text/html'}})));
    await expect(downloadContextImage(info.srcUrl)).rejects.toThrow('没有返回图片内容');
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(6_000_001));}, cancel}), {headers: {'content-type': 'image/png'}})));
    await expect(downloadContextImage(info.srcUrl)).rejects.toThrow('超过 6 MB');
    expect(cancel).toHaveBeenCalled();
  });

  it('reports a menu action failure instead of pretending it was added', async () => {
    const {chrome, events} = chromeMock();
    vi.stubGlobal('fetch', vi.fn(async () => {throw new TypeError('offline');}));
    installImageContextMenu(chrome); events.click!(info, tab);
    await vi.waitFor(() => expect(chrome.action.setBadgeText).toHaveBeenCalledWith({tabId: tab.id, text: '!'}));
    expect(chrome.action.setTitle).toHaveBeenLastCalledWith({tabId: tab.id, title: '请先打开妥帖，再添加图片'});
  });
});
