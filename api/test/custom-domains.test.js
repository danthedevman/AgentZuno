import { request as httpRequest } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { createApi } from '../src/app.js';
import { portalHostname } from '../src/identity/customDomains.js';
test('portal hostnames reject URLs, local names, IPs and invalid labels', () => {
  assert.equal(portalHostname('Help.Company.com'), 'help.company.com');
  for (const value of [
    'localhost',
    'help.local',
    '127.0.0.1',
    'https://help.company.com',
    'help.company.com/path',
    'help.company.com:443',
    'help.company.com@evil.com',
    '*.company.com',
    '-help.company.com',
    'company.com',
  ])
    assert.throws(() => portalHostname(value));
});
test(
  'custom portal domains verify DNS, isolate workspaces, bind browser origins and revoke immediately',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
    const database = `agentzuno_domains_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_DATABASE = database;
    process.env.CUSTOM_DOMAIN_TARGET = 'app.example.com';
    process.env.COOKIE_SECURE = 'true';
    process.env.APP_ORIGIN = 'http://localhost:3000';
    let txt = '';
    let cname = 'wrong.example.com';
    const app = createApi({
      domainDns: { resolveTxt: async () => [[txt]], resolveCname: async () => [cname] },
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const client = new MongoClient(process.env.TEST_MONGODB_URI);
    async function call(actor, path, method = 'GET', body, extra = {}) {
      return new Promise((resolve, reject) => {
        const req = httpRequest(
          base + '/api' + path,
          {
            method,
            headers: {
              'Content-Type': 'application/json',
              ...(actor ? { cookie: actor.cookie, 'X-Workspace-Id': actor.workspaceId } : {}),
              ...extra,
            },
          },
          (res) => {
            let text = '';
            res.on('data', (chunk) => (text += chunk));
            res.on('end', () => {
              try {
                resolve({
                  status: res.statusCode,
                  body: JSON.parse(text),
                  cookie: res.headers['set-cookie']?.[0]?.split(';')[0],
                });
              } catch (error) {
                reject(error);
              }
            });
          },
        );
        req.on('error', reject);
        if (body !== undefined) req.write(JSON.stringify(body));
        req.end();
      });
    }
    async function register(name) {
      const result = await call(null, '/auth/register', 'POST', {
        email: `${name}@domain-fixture.test`,
        password: 'Fictional-domain-password!',
      });
      assert.equal(result.status, 201);
      return { ...result.body.user, cookie: result.cookie };
    }
    try {
      const owner = await register('owner');
      const other = await register('other');
      const employee = await register('employee');
      await call(owner, '/helpdesk/members', 'POST', {
        email: employee.email,
        role: 'user',
        queues: [],
        active: true,
        canApprove: false,
      });
      employee.workspaceId = owner.workspaceId;
      const domain = 'help.company.com';
      assert.equal((await call(employee, '/helpdesk/domain', 'PUT', { domain })).status, 403);
      const saved = await call(owner, '/helpdesk/domain', 'PUT', { domain });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.enabled, false);
      assert.equal((await call(other, '/helpdesk/domain', 'PUT', { domain })).status, 409);
      assert.equal((await call(owner, '/helpdesk/domain/verify', 'POST', {})).status, 409);
      txt = saved.body.txtValue;
      assert.equal((await call(owner, '/helpdesk/domain/verify', 'POST', {})).status, 200);
      assert.equal(
        (await call(owner, '/helpdesk/domain/enabled', 'PUT', { enabled: true })).status,
        409,
      );
      cname = 'app.example.com';
      assert.equal(
        (await call(owner, '/helpdesk/domain/enabled', 'PUT', { enabled: true })).status,
        200,
      );
      assert.equal(
        (await call(null, '/portal', 'GET', undefined, { Host: domain })).body.workspaceId,
        owner.workspaceId,
      );
      assert.equal(
        (await call(other, '/helpdesk/access', 'GET', undefined, { Host: domain })).status,
        403,
      );
      assert.equal(
        (
          await call(
            owner,
            '/helpdesk/domain/verify',
            'POST',
            {},
            { Host: domain, Origin: 'https://evil.example.com' },
          )
        ).status,
        403,
      );
      assert.equal(
        (await call(owner, '/helpdesk/domain/verify', 'POST', {}, { Origin: `https://${domain}` }))
          .status,
        403,
      );
      assert.equal(
        (
          await call(
            owner,
            '/helpdesk/domain/verify',
            'POST',
            {},
            { Host: domain, Origin: `https://${domain}` },
          )
        ).status,
        200,
      );
      txt = 'lost ownership';
      assert.equal(
        (await call(owner, '/helpdesk/domain/enabled', 'PUT', { enabled: false })).status,
        200,
      );
      assert.equal((await call(null, '/portal', 'GET', undefined, { Host: domain })).status, 421);
      assert.equal(
        (await call(owner, '/helpdesk/domain/enabled', 'PUT', { enabled: true })).status,
        409,
      );
      assert.equal((await call(owner, '/helpdesk/domain', 'DELETE')).status, 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.close();
      await client.db(database).dropDatabase();
      await client.close();
    }
  },
);
