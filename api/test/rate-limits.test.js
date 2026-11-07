import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import Redis from 'ioredis';
import { createRateLimits } from '../src/middleware/rateLimits.js';
import { secureCookies } from '../src/identity/cookieSecurity.js';

async function start(limits, scope = 'auth', options = {}) {
  const app = express();
  const limiter = limits.middleware(scope, { limit: 2, ...options });
  app.get('/login', limiter, (request, response) => response.json({ ok: true }));
  app.get('/register', limiter, (request, response) => response.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    get: (path = '/login') => fetch(`http://127.0.0.1:${server.address().port}${path}`),
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await limits.close();
    },
  };
}
test('local rate limits combine login and registration attempts', async () => {
  const app = await start(createRateLimits({ redisUrl: '' }));
  try {
    assert.equal((await app.get()).status, 200);
    assert.equal((await app.get('/register')).status, 200);
    const blocked = await app.get();
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
  } finally {
    await app.close();
  }
});
test(
  'Redis budgets survive API restarts and are shared across replicas',
  { skip: !process.env.TEST_REDIS_URL },
  async () => {
    const redisUrl = process.env.TEST_REDIS_URL,
      prefix = `az-test:${randomUUID()}:`;
    const client = new Redis(redisUrl);
    const apps = [];
    try {
      const first = await start(createRateLimits({ redisUrl, prefix }));
      apps.push(first);
      const second = await start(createRateLimits({ redisUrl, prefix }));
      apps.push(second);
      assert.equal((await first.get()).status, 200);
      assert.equal((await second.get('/register')).status, 200);
      assert.equal((await first.get()).status, 429);
      await first.close();
      apps.splice(apps.indexOf(first), 1);
      const restarted = await start(createRateLimits({ redisUrl, prefix }));
      apps.push(restarted);
      assert.equal((await restarted.get()).status, 429);
      const separate = await start(createRateLimits({ redisUrl, prefix }), 'attachments');
      apps.push(separate);
      assert.equal((await separate.get()).status, 200);
      const keys = await client.keys(`${prefix}*`);
      assert.equal(keys.length, 2);
      for (const key of keys) assert.ok((await client.pttl(key)) > 0);
    } finally {
      await Promise.all(apps.map((app) => app.close()));
      const keys = await client.keys(`${prefix}*`);
      if (keys.length) await client.del(...keys);
      client.disconnect();
    }
  },
);
test('configured Redis failure denies requests without revealing connection details', async () => {
  const app = await start(createRateLimits({ redisUrl: 'redis://127.0.0.1:1' }));
  try {
    const result = await app.get();
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), {
      error: 'Request protection is unavailable. Try again shortly.',
    });
  } finally {
    await app.close();
  }
});
test('HTTPS origin requires secure cookies even with the local default flag', () => {
  const origin = process.env.APP_ORIGIN,
    secure = process.env.COOKIE_SECURE;
  try {
    process.env.APP_ORIGIN = 'https://help.example.test';
    process.env.COOKIE_SECURE = 'false';
    assert.equal(secureCookies(), true);
    process.env.APP_ORIGIN = 'http://localhost:3000';
    assert.equal(secureCookies(), false);
    process.env.COOKIE_SECURE = 'true';
    assert.equal(secureCookies(), true);
  } finally {
    if (origin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = origin;
    if (secure === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = secure;
  }
});
