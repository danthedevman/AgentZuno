import { randomBytes } from 'node:crypto';
import { createApi } from '../api/src/app.js';
import { createMemoryDatabase } from '../api/src/storage/memory.js';

// Browser regressions must never connect to a developer's database, Redis, or AI provider.
for (const key of [
  'MONGODB_URI',
  'POSTGRES_URL',
  'DATABASE_PROVIDER',
  'INSTALLATION_CONFIG_DIR',
  'REDIS_URL',
  'OLLAMA_URL',
  'QDRANT_URL',
])
  delete process.env[key];
process.env.APP_ORIGIN = 'http://127.0.0.1:4180';
process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.COOKIE_SECURE = 'false';
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.protocol === 'http:' && url.hostname === '127.0.0.1') return nativeFetch(input, options);
  throw new Error('External requests are disabled in the browser test API.');
};
const database = createMemoryDatabase();
const user = {
  id: '111111111111111111111111',
  workspaceId: '222222222222222222222222',
  name: 'Alex Morgan',
  email: 'alex@example.test',
  role: 'admin',
};
await database.collection('users').insertOne(user);
await database.collection('helpdeskMembers').insertOne({
  ownerId: user.id,
  workspaceId: user.workspaceId,
  userId: user.id,
  email: user.email,
  role: 'admin',
  active: true,
  queues: [],
  version: 1,
});
const auth = {
  currentUser: async (request) =>
    request.headers.cookie?.includes('browser_test=1') ? user : null,
  accounts: { findById: async (id) => database.collection('users').findOne({ id }) },
  close: async () => {},
  login: (request, response) => response.status(403).json({ error: 'Test fixture' }),
  register: (request, response) => response.status(403).json({ error: 'Test fixture' }),
  logout: (request, response) => response.json({ user: null }),
};
const app = createApi({ database, auth });
const server = app.listen(4181, '127.0.0.1', () => console.log('Isolated browser test API ready'));
await new Promise((resolve) => (server.listening ? resolve() : server.once('listening', resolve)));
const seeded = await nativeFetch('http://127.0.0.1:4181/api/helpdesk/demo/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', cookie: 'browser_test=1' },
  body: JSON.stringify({ action: 'load', industry: 'tech', enableApprovals: true }),
});
if (!seeded.ok) throw new Error(await seeded.text());
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await app.locals.close();
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => close().catch(() => (process.exitCode = 1)));
