import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../../dist/htpo.min.js', import.meta.url));
const page = '<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Standalone test</title></head><body></body></html>';
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method === 'GET' && request.url === '/htpo.min.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); response.end(script);
  } else if (request.method === 'GET' && request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(page);
  } else { response.writeHead(404); response.end('Not found'); }
});
server.listen(5181, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
