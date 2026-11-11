import http from 'node:http';
import {ClipboardStore} from '../clipboard/store';
import {pasteImageToBlender, type ImagePasteTarget} from './blender';
import {BLENDER_BRIDGE_PORT} from './standard';

export interface BlenderBridge {
  close(): Promise<void>;
}

export function startBlenderBridge(options: {directory: string; target: ImagePasteTarget; port?: number}): Promise<BlenderBridge> {
  const server = http.createServer((req, res) => {
    void handle(req, res, options).catch(error => {
      if (res.headersSent) return;
      const message = error instanceof Error ? error.message : String(error);
      const body = JSON.stringify({error: message});
      res.writeHead(400, {'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body)});
      res.end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? BLENDER_BRIDGE_PORT, '127.0.0.1', () => {
      resolve({close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done()))});
    });
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse, options: {directory: string; target: ImagePasteTarget}) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.method !== 'POST' || url.pathname !== '/v1/paste') {
    const body = JSON.stringify({error: '没有这个 Blender 接口'});
    res.writeHead(404, {'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body)});
    res.end(body);
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {itemId?: unknown};
  if (typeof payload.itemId !== 'string') throw new Error('粘贴参数无效');
  const store = new ClipboardStore(options.directory);
  const item = store.get(payload.itemId);
  if (!item) throw new Error('剪贴板没有这项');
  await pasteImageToBlender(options.target, item, store);
  const body = JSON.stringify({ok: true});
  res.writeHead(200, {'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body)});
  res.end(body);
}
