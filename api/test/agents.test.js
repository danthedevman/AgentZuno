import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { createApiServer } from '../src/app.js';
const uri = process.env.TEST_MONGODB_URI;
test(
  'retired external agent, token and MCP endpoints cannot be used by existing authenticated accounts',
  { skip: !uri },
  async () => {
    process.env.MONGODB_URI = uri;
    const database = `agentzuno_retired_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_DATABASE = database;
    const server = createApiServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const cleanup = new MongoClient(uri);
    try {
      const registration = await fetch(base + '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'retired@fixture.test',
          password: 'Fictional-retired-password!',
        }),
      });
      assert.equal(registration.status, 201);
      const cookie = registration.headers.get('set-cookie').split(';')[0];
      for (const [method, path] of [
        ['GET', '/api/agents'],
        ['POST', '/api/agents'],
        ['GET', '/api/agent-clients'],
        ['GET', '/api/agents/0123456789abcdef01234567'],
        ['POST', '/api/agents/0123456789abcdef01234567/tokens'],
        ['PATCH', '/api/agent-tokens/0123456789abcdef01234567'],
        ['GET', '/api/knowledge/bases'],
        ['POST', '/api/knowledge/search'],
        ['POST', '/api/mcp'],
        ['POST', '/api/records/agent'],
        ['GET', '/api/records/agent/0123456789abcdef01234567'],
      ]) {
        const response = await fetch(base + path, {
          method,
          headers: {
            cookie,
            'Content-Type': 'application/json',
            Authorization: 'Bearer legacy-fixture',
          },
          ...(method === 'GET' ? {} : { body: '{}' }),
        });
        assert.ok(
          [404, 405].includes(response.status),
          method + ' ' + path + ' ' + response.status,
        );
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await cleanup.db(database).dropDatabase();
      await cleanup.close();
    }
  },
);
