import https from 'node:https';
import {readFileSync} from 'node:fs';

// Certificate generation, trust changes and sideload installation are separate
// explicit setup steps. This server never changes system trust or app settings.
const [keyPath, certPath] = process.argv.slice(2);
if (!keyPath || !certPath) throw new Error('用法：node serve.mjs <localhost-key.pem> <localhost-cert.pem>');
const files = new Map([
  ['/word-probe.html', ['word-probe.html', 'text/html; charset=utf-8']],
  ['/word-probe.js', ['word-probe.js', 'text/javascript; charset=utf-8']],
]);
const server = https.createServer({key: readFileSync(keyPath), cert: readFileSync(certPath)}, (request, response) => {
  const resource = files.get(request.url);
  if (request.method !== 'GET' || !resource) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, {'Content-Type': resource[1], 'Cache-Control': 'no-store'});
  response.end(readFileSync(new URL(resource[0], import.meta.url)));
});
server.listen(47722, '127.0.0.1', () => console.log('Word 测试页：https://localhost:47722/word-probe.html'));
