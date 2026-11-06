import { createServer } from 'node:http';
import { createApi } from './app.js';

export function createApiServer(options = {}) {
  const app = createApi(options);
  const server = createServer(app);
  server.on('close', () => app.locals.close());
  return server;
}
