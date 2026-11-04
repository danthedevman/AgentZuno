import { needsDatabaseSetup } from './storage/configuration.js';
if (needsDatabaseSetup()) process.exit(0);
import Redis from 'ioredis';
const connection = new Redis(process.env.REDIS_URL, {
  connectTimeout: 3000,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
});
connection.on('error', () => {});
try {
  const heartbeat = Number(await connection.get('agentzuno-worker-heartbeat'));
  process.exitCode = heartbeat && Date.now() - heartbeat < 120000 ? 0 : 1;
} catch {
  process.exitCode = 1;
} finally {
  connection.disconnect();
}
