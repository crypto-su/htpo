import { createServer } from 'vite';

// An empty document for SDK tests; source modules use the library's Vite plugins.
const server = await createServer({
  appType: 'custom',
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  plugins: [{
    name: 'htpo-test-document',
    configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (request.url !== '/') return next();
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><html><head><meta charset="utf-8"><title>SDK tests</title></head><body></body></html>');
      });
    },
  }],
});

await server.listen();
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => { await server.close(); process.exit(0); });
}
