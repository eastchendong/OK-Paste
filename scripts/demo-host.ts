import {publicSettings} from '../src/app-settings';
import {build} from 'esbuild';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {handleClipboard, type ClipboardServerOptions, type SceneAgentRoutes} from '../src/clipboard/server';
import {ClipboardStore} from '../src/clipboard/store';
import {ClipboardInputError} from '../src/clipboard/types';
import {DestinationRegistry} from '../src/destinations/registry';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browserDir = path.join(root, 'browser');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const WEBM = Buffer.from('1a45dfa3', 'hex');

export async function buildBrowserBundle() {
  await build({entryPoints: [path.join(root, 'src/browser/content-script.ts')], bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', outfile: path.join(browserDir, 'content.js')});
  await build({entryPoints: [path.join(root, 'src/browser/background.ts')], bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', outfile: path.join(browserDir, 'background.js')});
}

export async function startDemoHost(options: {directory: string; port: number; destinations?: DestinationRegistry; pasteboard?: ClipboardServerOptions['pasteboard']; store?: ClipboardStore; agent?: SceneAgentRoutes; onChange?:()=>void}) {
  await buildBrowserBundle();
  const store = options.store ?? new ClipboardStore(options.directory);
  const destinations = options.destinations ?? new DestinationRegistry();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/v1/') || url.pathname === '/health') {
      void handleClipboard(req, res, {store, destinations, onChange:options.onChange, pasteboard: options.pasteboard, agent: options.agent, settings:()=>publicSettings(root)}).catch(error => {
        if (res.headersSent) return;
        const message = error instanceof Error ? error.message : String(error);
        const body = JSON.stringify({error: message});
        res.writeHead(error instanceof ClipboardInputError ? 400 : 500, {'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body)});
        res.end(body);
      });
      return;
    }
    if (url.pathname === '/sample.png') return sendBytes(req, res, PNG, 'image/png');
    if (url.pathname === '/reference.jpg') return sendBytes(req, res, fs.readFileSync(path.join(root, 'assets/reference/apple.jpg')), 'image/jpeg');
    if (url.pathname === '/sample.webm') return sendBytes(req, res, WEBM, 'video/webm');
    const name = url.pathname === '/' || url.pathname === '/demo' ? 'demo.html' : path.basename(url.pathname);
    if (!['demo.html', 'content.js', 'demo-reader.js', 'component-library.css'].includes(name)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const body = fs.readFileSync(path.join(browserDir, name));
    const type = name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
    res.writeHead(200, {'content-type': type, 'content-length': body.length, 'cache-control': 'no-store'});
    res.end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => resolve());
  });
  return {
    url: `http://127.0.0.1:${options.port}/`,
    directory: options.directory,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

function sendBytes(req: http.IncomingMessage, res: http.ServerResponse, body: Buffer, type: string) {
  res.writeHead(200, {'content-type': type, 'content-length': body.length, 'cache-control': 'no-store'});
  res.end(req.method === 'HEAD' ? undefined : body);
}
