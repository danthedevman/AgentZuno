import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { createApiServer } from '../src/server.js';

const uri = process.env.TEST_MONGODB_URI;

test(
  'MongoDB persists every record type and enforces article, file, and image ownership',
  { skip: !uri },
  async () => {
    const originalUri = process.env.MONGODB_URI;
    const originalDatabase = process.env.MONGODB_DATABASE;
    process.env.MONGODB_URI = uri;
    const databaseName = 'agentzuno_test_' + randomUUID().replaceAll('-', '');
    process.env.MONGODB_DATABASE = databaseName;
    const client = new MongoClient(uri);
    let server;
    let origin;
    async function start() {
      server = createApiServer();
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      origin = `http://127.0.0.1:${server.address().port}`;
    }
    async function login(name) {
      const created = await fetch(origin + '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `${name}@fixtures.test`, password: 'ExploreAgentZuno!' }),
      });
      if (created.status === 201) return created.headers.get('set-cookie').split(';')[0];
      const result = await fetch(origin + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `${name}@fixtures.test`,
          password: 'ExploreAgentZuno!',
        }),
      });
      assert.equal(result.status, 200);
      return result.headers.get('set-cookie').split(';')[0];
    }
    function post(path, cookie, value) {
      return fetch(origin + path, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
    }
    try {
      await start();
      let alex = await login('alex');
      const jordan = await login('jordan');
      const topicResponse = await post('/api/topics', alex, {
        name: 'General Support',
        description: '',
        articleIds: [],
      });
      const topic = await topicResponse.json();
      const jordanTopic = await (
        await post('/api/topics', jordan, {
          name: 'Other Support',
          description: '',
          articleIds: [],
        })
      ).json();
      const registration = await post('/api/auth/register', '', {
        email: 'new-user@example.test',
        password: 'A-strong-test-password',
      });
      assert.equal(registration.status, 201);
      const registered = await registration.json();
      const registeredCookie = registration.headers.get('set-cookie').split(';')[0];
      assert.match(registered.user.workspaceId, /^[a-f0-9]{24}$/);
      assert.ok(!JSON.stringify(registered).includes('passwordHash'));
      const scoped = await fetch(origin + '/api/workspaces/' + registered.user.workspaceId, {
        headers: { Cookie: registeredCookie },
      });
      assert.equal(scoped.status, 200);
      assert.deepEqual((await scoped.json()).articles, []);
      assert.equal(
        (
          await fetch(origin + '/api/workspaces/' + registered.user.workspaceId, {
            headers: { Cookie: alex },
          })
        ).status,
        403,
      );
      assert.equal(
        (await fetch(origin + '/api/workspaces/' + registered.user.workspaceId)).status,
        401,
      );
      assert.equal(
        (
          await fetch(origin + '/api/articles', {
            method: 'POST',
            headers: {
              Cookie: registeredCookie,
              'Content-Type': 'application/json',
              'X-Workspace-Id': 'demo-alex',
            },
            body: JSON.stringify({ title: 'Forbidden', body: '<p>Body</p>' }),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await post('/api/auth/register', '', {
            email: 'NEW-USER@example.test',
            password: 'A-strong-test-password',
          })
        ).status,
        409,
      );
      assert.equal(
        (await post('/api/auth/register', '', { email: 'weak@example.test', password: 'short' }))
          .status,
        400,
      );

      assert.equal(
        (await post('/api/articles', '', { title: 'Test', body: '<p>Test</p>' })).status,
        401,
      );
      assert.equal(
        (await post('/api/articles', alex, { title: '', body: '<p>Body</p>' })).status,
        400,
      );
      const png = await sharp({
        create: { width: 2, height: 2, channels: 3, background: '#42aaff' },
      })
        .png()
        .toBuffer();
      const uploaded = await fetch(origin + '/api/uploads/images', {
        method: 'POST',
        headers: { Cookie: alex, 'Content-Type': 'image/png' },
        body: png,
      });
      assert.equal(uploaded.status, 201);
      const image = await uploaded.json();
      assert.equal((await fetch(origin + image.src)).status, 401);
      assert.equal((await fetch(origin + image.src, { headers: { Cookie: jordan } })).status, 404);
      const imageResponse = await fetch(origin + image.src, { headers: { Cookie: alex } });
      assert.equal(imageResponse.status, 200);
      assert.match(imageResponse.headers.get('content-type'), /image\/webp/);
      assert.ok((await imageResponse.arrayBuffer()).byteLength > 0);
      const body = `<h2>Rich body</h2><p><strong>Bold</strong> text</p><img src="${image.src}" alt="Test"><script>alert(1)</script><img src="https://example.com/foreign.png">`;
      const response = await post('/api/articles', alex, {
        topicIds: [topic.id],
        title: 'Saved article',
        body,
        ownerId: 'jordan',
      });
      assert.equal(response.status, 201);
      const article = await response.json();
      assert.ok(article.body.includes('<strong>Bold</strong>'));
      const update = {
        method: 'PATCH',
        headers: { Cookie: alex, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated article', body }),
      };
      assert.equal(
        (
          await fetch(origin + '/api/articles/' + article.id, {
            ...update,
            headers: { ...update.headers, Cookie: jordan },
          })
        ).status,
        404,
      );
      const updated = await fetch(origin + '/api/articles/' + article.id, update);
      assert.equal(updated.status, 200);
      assert.equal((await updated.json()).title, 'Updated article');

      assert.ok(article.body.includes(image.src));
      assert.ok(!article.body.includes('<script'));
      assert.ok(!article.body.includes('foreign.png'));
      assert.equal(
        (
          await post('/api/articles', jordan, {
            title: 'Foreign image',
            body,
            topicIds: [jordanTopic.id],
          })
        ).status,
        400,
      );
      assert.equal(
        (await fetch(origin + '/api/articles/' + article.id, { headers: { Cookie: jordan } }))
          .status,
        404,
      );
      const fileResponse = await fetch(origin + '/api/uploads/files', {
        method: 'POST',
        headers: {
          Cookie: alex,
          'Content-Type': 'application/octet-stream',
          'X-File-Name': 'notes.txt',
        },
        body: 'Saved file body',
      });
      assert.equal(fileResponse.status, 201);
      const upload = await fileResponse.json();
      const ids = {};
      for (const type of ['knowledge-base', 'file', 'connection']) {
        const recordResponse = await post('/api/records/' + type, alex, {
          name: 'Saved ' + type,
          description: 'Details',
          uploadId: upload.id,
          ownerId: 'jordan',
        });
        assert.equal(recordResponse.status, 201);
        ids[type] = (await recordResponse.json()).id;
      }
      for (const type of ['knowledge-base', 'file', 'connection']) {
        const path = `/api/records/${type}/${ids[type]}`;
        const options = {
          method: 'PATCH',
          headers: { Cookie: alex, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `Updated ${type}`, description: 'Edited details' }),
        };
        const edited = await fetch(origin + path, options);
        assert.equal(edited.status, 200);
        const value = await edited.json();
        assert.equal(value.name, `Updated ${type}`);
        if (type === 'file') assert.equal(value.uploadId, upload.id);
        assert.equal(
          (
            await fetch(origin + path, {
              ...options,
              headers: { ...options.headers, Cookie: jordan },
            })
          ).status,
          404,
        );
        assert.equal((await fetch(origin + path)).status, 401);
      }
      assert.equal(
        (await post('/api/records/file', jordan, { name: 'Foreign file', uploadId: upload.id }))
          .status,
        400,
      );
      assert.equal(
        (await fetch(origin + '/api/uploads/files/' + upload.id, { headers: { Cookie: jordan } }))
          .status,
        404,
      );
      assert.equal(
        await (
          await fetch(origin + '/api/uploads/files/' + upload.id, { headers: { Cookie: alex } })
        ).text(),
        'Saved file body',
      );
      await new Promise((resolve) => server.close(resolve));
      await start();
      assert.equal(
        (
          await (
            await fetch(origin + '/api/auth/session', { headers: { Cookie: registeredCookie } })
          ).json()
        ).user.workspaceId,
        registered.user.workspaceId,
      );
      alex = await login('alex');
      const workspace = await (
        await fetch(origin + '/api/workspace', { headers: { Cookie: alex } })
      ).json();
      assert.ok(workspace.articles.some((item) => item.id === article.id));
      for (const [type, key] of Object.entries({
        'knowledge-base': 'knowledgeBases',
        file: 'files',
        connection: 'integrations',
      }))
        assert.ok(workspace[key].some((item) => item.id === ids[type]));
      assert.equal((await fetch(origin + image.src, { headers: { Cookie: alex } })).status, 200);
      const guest = await (await fetch(origin + '/api/workspace')).json();
      assert.ok(!JSON.stringify(guest).includes(article.id));
    } finally {
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      await client.db(databaseName).dropDatabase();
      await client.close();
      if (originalUri === undefined) delete process.env.MONGODB_URI;
      else process.env.MONGODB_URI = originalUri;
      if (originalDatabase === undefined) delete process.env.MONGODB_DATABASE;
      else process.env.MONGODB_DATABASE = originalDatabase;
    }
  },
);
