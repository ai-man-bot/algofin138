import { createServer } from 'vite';
const server = await createServer({ server: { host: '127.0.0.1', port: 5180, strictPort: true, open: false } });
await server.listen();
server.printUrls();
