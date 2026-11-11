import type {InputCapture,InputReceipt,InputExchange} from '../targets/input-live';
import type {AppContext} from '../app-context';
import {inputScreenshot} from '../native-drop';
import http from 'node:http';
import path from 'node:path';
import {ClipboardInputError, type ClipboardDraft, type ClipboardItem} from './types';
import type {ClipboardStore} from './store';
import type {DestinationRegistry} from '../destinations/registry';
import {CLIPBOARD_ITEMS_PATH} from './port';

export interface ClipboardServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export type PasteboardWriter = (item: ClipboardItem, bytes: Buffer | undefined, filePath?: string) => void;

export interface SceneAgentRoutes {
  status(): unknown;
  preparePackDrag?():Promise<{ok:boolean;error?:string}>;
  cancelNativeDrop?(id:string):Promise<{ok:boolean;error?:string}>;
  beginInputPaste?(capture:InputCapture):Promise<unknown>;
  exchangeInput?(id:string,receipt?:InputReceipt):InputExchange;
  beginWordPaste?(focus:AppContext):Promise<unknown>;
  beginExcelPaste?(focus:AppContext):Promise<unknown>;
  beginPowerPointPaste?(focus:AppContext):Promise<unknown>;
  beginIllustratorPaste?(focus:AppContext):Promise<unknown>;
  beginFigmaPaste?(focus:AppContext):Promise<unknown>;
  beginBlenderPaste?(focus:AppContext):Promise<unknown>;
  updateFocus?(focus:AppContext):Promise<unknown>;
  markAnchor?(focus:AppContext|null):Promise<unknown>;
  run(input: {continuation?:boolean;destinationId?:string;itemId?: string; itemIds?: string[]; actionIndex: number; instruction?: string; dropEventId?: string}): {ok: boolean; error?: string; phase?: string};
  control?(action: 'commit' | 'cancel' | 'undo' | 'retry' | 'finish'): Promise<{ok: boolean; error?: string}>;
  supplement?(instruction: string): {ok: boolean; error?: string};
  selectTarget?(input:{id:string;path?:string}):Promise<unknown>;
  dismissDrop?(eventId?: string): {ok: boolean};
}

export interface ClipboardServerOptions {
  settings?: () => unknown;
  store: ClipboardStore;
  destinations: DestinationRegistry;
  port?: number;
  host?: string;
  onChange?: () => void;
  pasteboard?: PasteboardWriter;
  agent?: SceneAgentRoutes;
}

export function startClipboardServer(options: ClipboardServerOptions): Promise<ClipboardServer> {
  const host = options.host ?? '127.0.0.1';
  const server = http.createServer((req, res) => {
    void handleClipboard(req, res, options).catch(error => {
      if (!res.headersSent) sendJson(req, res, error instanceof ClipboardInputError ? 400 : 500, {error: error instanceof Error ? error.message : String(error)});
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('剪贴板服务没有绑定到本机端口'));
        return;
      }
      resolve({
        url: `http://${host}:${address.port}`,
        port: address.port,
        close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done())),
      });
    });
  });
}

export async function handleClipboard(req: http.IncomingMessage, res: http.ServerResponse, options: ClipboardServerOptions) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if(url.pathname.startsWith('/v1/agent/')&&req.headers.origin&&['input-live','word-live','excel-live','powerpoint-live','illustrator-live','figma-live'].includes((options.agent?.status() as {targetKind?:string})?.targetKind||'')){
    res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Office 任务仅供本机妥帖操作'}));return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors(req));
    res.end();
    return;
  }
  if (req.method === 'GET' && url.pathname === '/v1/settings') {
    sendJson(req,res,200,options.settings?.() ?? {shortcuts:{}});return;
  }
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(req, res, 200, {ok: true});
    return;
  }
  if (req.method === 'GET' && url.pathname === CLIPBOARD_ITEMS_PATH) {
    sendJson(req, res, 200, {items: options.store.publicList(url.searchParams.get('preview') !== '0', url.searchParams.get('includeArchived') === '1')});
    return;
  }
  if (req.method === 'POST' && url.pathname === '/v1/clipboard/archive') {
    const body = await readJson(req) as {itemIds?:unknown};
    if (!Array.isArray(body.itemIds) || body.itemIds.some(id => typeof id !== 'string')) {
      sendJson(req,res,400,{error:'归档内容无效'});return;
    }
    const archived = options.store.archive(body.itemIds as string[]);
    options.onChange?.(); sendJson(req,res,200,{ok:true,archived});return;
  }
  if (req.method === 'POST' && url.pathname === CLIPBOARD_ITEMS_PATH) {
    const draft = await readJson(req);
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
      sendJson(req, res, 400, {error: '内容格式无效'});
      return;
    }
    try {
      const item = options.store.add(draft as ClipboardDraft);
      const saved = options.store.get(item.id) ?? item;
      let pasteboardError: string | undefined;
      if (options.pasteboard) {
        try {
          const filename = typeof saved.body.file === 'string' ? saved.body.file : '';
          const filePath = filename ? path.join(options.store.directory, 'files', filename) : undefined;
          options.pasteboard(saved, options.store.readContent(saved.id), filePath);
        } catch (error) {
          pasteboardError = error instanceof Error ? error.message : String(error);
        }
      }
      options.onChange?.();
      sendJson(req, res, 201, {item: options.store.toPublic(saved), ...(pasteboardError ? {pasteboardError} : {})});
    } catch (error) {
      sendJson(req, res, error instanceof ClipboardInputError ? 400 : 500, {error: error instanceof Error ? error.message : String(error)});
    }
    return;
  }
  const itemMatch = new RegExp(`^${CLIPBOARD_ITEMS_PATH}/([0-9a-f-]{36})(/content)?$`, 'i').exec(url.pathname);
  if (req.method === 'GET' && itemMatch) {
    const item = options.store.get(itemMatch[1] ?? '');
    if (!item) {
      sendJson(req, res, 404, {error: '剪贴板没有这项'});
      return;
    }
    if (itemMatch[2]) {
      const bytes = options.store.readContent(item.id);
      if (!bytes) {
        sendJson(req, res, 404, {error: '这项没有保存内容'});
        return;
      }
      const mime = typeof item.body.mime === 'string' ? item.body.mime : 'application/octet-stream';
      res.writeHead(200, {...cors(req), 'content-type': mime, 'cache-control': 'no-store', 'content-length': bytes.length});
      res.end(bytes);
      return;
    }
    sendJson(req, res, 200, {item: options.store.toPublic(item)});
    return;
  }
  if (req.method === 'GET' && url.pathname === '/v1/clipboard/destinations') {
    const type = url.searchParams.get('type');
    const destinations = options.destinations.list().filter(destination => !type || destination.accepts.includes('*') || destination.accepts.includes(type));
    sendJson(req, res, 200, {destinations});
    return;
  }
  if (req.method === 'POST' && url.pathname === '/v1/clipboard/paste') {
    const body = await readJson(req) as {itemId?: unknown; destinationId?: unknown};
    if (typeof body.itemId !== 'string' || typeof body.destinationId !== 'string') {
      sendJson(req, res, 400, {error: '粘贴参数无效'});
      return;
    }
    const item = options.store.get(body.itemId);
    if (!item) {
      sendJson(req, res, 404, {error: '剪贴板没有这项'});
      return;
    }
    try {
      await options.destinations.paste(body.destinationId, item, options.store);
      options.onChange?.();
      sendJson(req, res, 200, {ok: true});
    } catch (error) {
      sendJson(req, res, 400, {error: error instanceof Error ? error.message : String(error)});
    }
    return;
  }
  if(req.method==='POST'&&['/v1/agent/pack-drag','/v1/agent/pack-drop-cancel'].includes(url.pathname)){
    if(req.headers.origin||req.headers['x-tuotie-native']!=='pack-drag'){sendJson(req,res,403,{error:'请从妥帖内容框拖动资料'});return;}
    const body=await readJson(req) as {id?:unknown};
    if(url.pathname==='/v1/agent/pack-drop-cancel'){
      if(typeof body.id!=='string'||!/^[a-f0-9-]{36}$/i.test(body.id)){sendJson(req,res,400,{error:'无效的拖放标识'});return;}
      if(!options.agent?.cancelNativeDrop){sendJson(req,res,503,{error:'内容拖放服务需要更新'});return;}
      sendJson(req,res,200,await options.agent.cancelNativeDrop(body.id));return;
    }
    if(!options.agent?.preparePackDrag){sendJson(req,res,503,{error:'内容拖放服务需要更新，请重新打开妥帖'});return;}
    sendJson(req,res,200,await options.agent.preparePackDrag());return;
  }
  if(req.method==='POST'&&['/v1/agent/input-paste','/v1/agent/input-exchange'].includes(url.pathname)){
    if(req.headers.origin||req.headers['x-tuotie-native']!=='input-paste'){sendJson(req,res,403,{error:'请从妥帖快捷键使用输入框'});return;}
    const body=await readJson(req) as InputCapture&{receipt?:InputReceipt};
    if(typeof body.id!=='string'||!/^[a-f0-9-]{36}$/i.test(body.id)){sendJson(req,res,400,{error:'无效的输入框任务'});return;}
    if(url.pathname.endsWith('exchange')&&options.agent?.exchangeInput){
      const receipt=body.receipt;
      if(receipt&&(typeof receipt.id!=='string'||typeof receipt.ok!=='boolean')){sendJson(req,res,400,{error:'无效的写入回执'});return;}
      sendJson(req,res,200,options.agent.exchangeInput(body.id,receipt));return;
    }
    if(options.agent?.beginInputPaste&&url.pathname.endsWith('input-paste')&&typeof body.manual==='boolean'&&typeof body.focus?.appName==='string'&&body.focus.bundleId){
      sendJson(req,res,200,await options.agent.beginInputPaste({id:body.id,focus:body.focus,manual:body.manual,screenshot:inputScreenshot(body.screenshot)}));return;
    }
    sendJson(req,res,400,{error:'无法捕获当前输入框'});return;
  }
  if(options.agent?.beginWordPaste&&req.method==='POST'&&url.pathname==='/v1/agent/word-paste'){
    // Only the native host starts captures. Browser origins must not trigger document reads.
    if(req.headers.origin||!['office-paste','word-paste'].includes(String(req.headers['x-tuotie-native']))){sendJson(req,res,403,{error:'请使用 Word 中的快捷键'});return;}
    const body=await readJson(req) as AppContext;
    if(body.bundleId!=='com.microsoft.Word'||typeof body.appName!=='string'){sendJson(req,res,400,{error:'请在 Word 正文中使用快捷键'});return;}
    sendJson(req,res,200,await options.agent.beginWordPaste(body));return;
  }
  if(options.agent?.beginExcelPaste&&req.method==='POST'&&url.pathname==='/v1/agent/excel-paste'){
    if(req.headers.origin||req.headers['x-tuotie-native']!=='office-paste'){sendJson(req,res,403,{error:'请使用 Excel 中的快捷键'});return;}
    const body=await readJson(req) as AppContext;
    if(body.bundleId!=='com.microsoft.Excel'||typeof body.appName!=='string'){sendJson(req,res,400,{error:'请在 Excel 选择单元格后使用快捷键'});return;}
    sendJson(req,res,200,await options.agent.beginExcelPaste(body));return;
  }
  if(options.agent?.beginPowerPointPaste&&req.method==='POST'&&url.pathname==='/v1/agent/powerpoint-paste'){
    if(req.headers.origin||req.headers['x-tuotie-native']!=='office-paste'){sendJson(req,res,403,{error:'请使用 PowerPoint 中的快捷键'});return;}
    const body=await readJson(req) as AppContext;
    if(body.bundleId!=='com.microsoft.Powerpoint'||typeof body.appName!=='string'){sendJson(req,res,400,{error:'请在 PowerPoint 选择图片后使用快捷键'});return;}
    sendJson(req,res,200,await options.agent.beginPowerPointPaste(body));return;
  }
  if(options.agent?.beginIllustratorPaste&&req.method==='POST'&&url.pathname==='/v1/agent/illustrator-paste'){
    if(req.headers.origin||req.headers['x-tuotie-native']!=='office-paste'){sendJson(req,res,403,{error:'请使用 Illustrator 中的快捷键'});return;}
    const body=await readJson(req) as AppContext;
    if(body.bundleId!=='com.adobe.illustrator'||typeof body.appName!=='string'){sendJson(req,res,400,{error:'请在 Illustrator 激活画板后使用快捷键'});return;}
    sendJson(req,res,200,await options.agent.beginIllustratorPaste(body));return;
  }
  if(options.agent?.beginFigmaPaste&&req.method==='POST'&&url.pathname==='/v1/agent/figma-paste'){
    if(req.headers.origin||req.headers['x-tuotie-native']!=='office-paste'){sendJson(req,res,403,{error:'请使用 Figma 中的快捷键'});return;}
    const body=await readJson(req) as AppContext;
    if(body.bundleId!=='com.figma.Desktop'||typeof body.appName!=='string'){sendJson(req,res,400,{error:'请在 Figma 选中画框后使用快捷键'});return;}
    sendJson(req,res,200,await options.agent.beginFigmaPaste(body));return;
  }
  if(options.agent?.beginBlenderPaste&&req.method==='POST'&&url.pathname==='/v1/agent/blender-paste'){
    if(req.headers.origin||req.headers['x-tuotie-native']!=='office-paste'){sendJson(req,res,403,{error:'请使用 Blender 中的快捷键'});return;}
    const body=await readJson(req) as AppContext;
    if(body.bundleId!=='org.blenderfoundation.blender'||typeof body.appName!=='string'){sendJson(req,res,400,{error:'请在 Blender 三维视口中使用快捷键'});return;}
    sendJson(req,res,200,await options.agent.beginBlenderPaste(body));return;
  }
  if(options.agent?.markAnchor&&req.method==='POST'&&url.pathname==='/v1/agent/anchor'){
    const body=await readJson(req) as {focus:AppContext|null};
    if(body.focus!==null&&(!body.focus||typeof body.focus.appName!=='string'||typeof body.focus.bundleId!=='string'||!body.focus.editAnchor)){sendJson(req,res,400,{error:'修改位置无效'});return;}
    sendJson(req,res,200,await options.agent.markAnchor(body.focus));return;
  }
  if(options.agent?.updateFocus&&req.method==='POST'&&url.pathname==='/v1/agent/focus'){
    const body=await readJson(req) as AppContext;
    if(typeof body.appName!=='string'||typeof body.bundleId!=='string'){sendJson(req,res,400,{error:'聚焦应用无效'});return;}
    sendJson(req,res,200,await options.agent.updateFocus(body));return;
  }
  if (options.agent && req.method === 'GET' && url.pathname === '/v1/agent/status') {
    sendJson(req, res, 200, options.agent.status());
    return;
  }
  if (options.agent?.selectTarget && req.method === 'POST' && url.pathname === '/v1/agent/target') {
    const body = await readJson(req) as {id?:unknown;path?:unknown};
    if(typeof body.id !== 'string'){sendJson(req,res,400,{error:'目标无效'});return;}
    sendJson(req,res,200,await options.agent.selectTarget({id:body.id,...(typeof body.path==='string'?{path:body.path}:{})}));return;
  }
  if (options.agent && req.method === 'POST' && url.pathname === '/v1/agent/drop/dismiss') {
    const body = await readJson(req) as {eventId?: unknown};
    const result = options.agent.dismissDrop?.(typeof body.eventId === 'string' ? body.eventId : undefined) ?? {ok: true};
    sendJson(req, res, 200, result);
    return;
  }
  if (options.agent && req.method === 'POST' && url.pathname === '/v1/agent/run') {
    const body = await readJson(req) as {continuation?:unknown;destinationId?:unknown;itemId?: unknown; itemIds?: unknown; actionIndex?: unknown; instruction?: unknown; dropEventId?: unknown};
    const actionIndex = typeof body.actionIndex === 'number' ? body.actionIndex : Number(body.actionIndex);
    if (!Number.isInteger(actionIndex)) {
      sendJson(req, res, 400, {error: '推荐序号无效'});
      return;
    }
    const result = options.agent.run({
      itemId: typeof body.itemId === 'string' ? body.itemId : undefined,
      ...(Array.isArray(body.itemIds) ? {itemIds: body.itemIds.filter((id): id is string => typeof id === 'string')} : {}),
      actionIndex,
      ...(body.continuation === true ? {continuation:true} : {}),
      ...(typeof body.destinationId==='string'?{destinationId:body.destinationId}:{}),
      ...(typeof body.instruction === 'string' ? {instruction: body.instruction} : {}),
      dropEventId: typeof body.dropEventId === 'string' ? body.dropEventId : undefined,
    });
    sendJson(req, res, result.ok ? 200 : 409, result);
    return;
  }
  if (options.agent?.control && req.method === 'POST' && url.pathname === '/v1/agent/control') {
    const body = await readJson(req) as {action?: unknown};
    if (!['commit', 'cancel', 'undo', 'retry', 'finish'].includes(String(body.action))) {
      sendJson(req, res, 400, {error: '未知操作'}); return;
    }
    const result = await options.agent.control(body.action as 'commit' | 'cancel' | 'undo' | 'retry' | 'finish');
    sendJson(req, res, result.ok ? 200 : 409, result); return;
  }
  if (options.agent?.supplement && req.method === 'POST' && url.pathname === '/v1/agent/supplement') {
    const body = await readJson(req) as {instruction?: unknown};
    const result = options.agent.supplement(typeof body.instruction === 'string' ? body.instruction : '');
    sendJson(req, res, result.ok ? 200 : 409, result); return;
  }
  sendJson(req, res, 404, {error: '没有这个剪贴板接口'});
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BYTES_REQUEST) throw new ClipboardInputError('内容太大');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ClipboardInputError('内容格式无效');
  }
}

const MAX_BYTES_REQUEST = 9_000_000;

function sendJson(req: http.IncomingMessage, res: http.ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {...cors(req), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body)});
  res.end(body);
}

function cors(req: http.IncomingMessage): http.OutgoingHttpHeaders {
  const origin = req.headers.origin;
  return {
    'access-control-allow-origin': typeof origin === 'string' ? origin : '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-private-network': 'true',
    vary: 'Origin',
  };
}
