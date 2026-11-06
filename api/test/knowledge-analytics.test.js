import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { MongoClient } from 'mongodb';
import { createApiServer } from '../src/server.js';

const uri = process.env.TEST_MONGODB_URI;
test(
  'article references, all-base snapshots, topics and knowledge analytics stay owner-scoped',
  { skip: !uri },
  async () => {
    process.env.MONGODB_URI = uri;
    const database = `agentzuno_analytics_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_DATABASE = database;
    const cleanup = new MongoClient(uri);
    const server = createApiServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    async function call(path, cookie, body, token) {
      const response = await fetch(origin + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        data: await response.json(),
        cookie: response.headers.get('set-cookie')?.split(';')[0],
      };
    }
    try {
      const owner = await call('/api/auth/register', null, {
        email: 'owner@analytics.test',
        password: 'Knowledge-dashboard-check!',
      });
      const other = await call('/api/auth/register', null, {
        email: 'other@analytics.test',
        password: 'Knowledge-dashboard-check!',
      });
      const workspace = (await call('/api/auth/session', owner.cookie)).data.user.workspaceId;
      const base = (
        await call('/api/records/knowledge-base', owner.cookie, {
          name: 'Policies',
          description: '',
        })
      ).data;
      const foreignBase = (
        await call('/api/records/knowledge-base', other.cookie, {
          name: 'Foreign base',
          description: '',
        })
      ).data;
      const topic = (
        await call('/api/topics', owner.cookie, {
          name: 'Security',
          description: 'Policies',
          articleIds: [],
        })
      ).data;
      const foreignTopic = (
        await call('/api/topics', other.cookie, {
          name: 'Foreign topic',
          description: '',
          articleIds: [],
        })
      ).data;
      const input = {
        title: 'Access policy',
        body: '<p>A useful access policy.</p>',
        knowledgeBaseId: base.id,
        topicIds: [topic.id],
      };
      const article = await call('/api/articles', owner.cookie, input);
      assert.equal(article.status, 201);
      assert.equal(article.data.base, base.id);
      assert.equal(
        (
          await call('/api/articles', owner.cookie, {
            ...input,
            knowledgeBaseIds: [base.id, workspace],
          })
        ).status,
        400,
      );
      assert.equal(
        (await call('/api/articles', owner.cookie, { ...input, knowledgeBaseId: null })).status,
        403,
      );
      assert.deepEqual(article.data.topicIds, [topic.id]);
      assert.equal(
        (await call('/api/articles', owner.cookie, { ...input, knowledgeBaseId: foreignBase.id }))
          .status,
        403,
      );
      assert.equal(
        (
          await call('/api/articles', owner.cookie, {
            ...input,
            knowledgeBaseId: [workspace, base.id],
          })
        ).status,
        403,
      );
      assert.equal(
        (await call('/api/articles', owner.cookie, { ...input, topicIds: [foreignTopic.id] }))
          .status,
        403,
      );
      const patched = await fetch(origin + `/api/articles/${article.data.id}`, {
        method: 'PATCH',
        headers: { Cookie: owner.cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated access policy', body: input.body }),
      });
      assert.equal(patched.status, 200);
      const updated = await patched.json();
      assert.equal(updated.base, base.id);
      assert.deepEqual(updated.topicIds, [topic.id]);
      assert.equal(updated.status, 'Draft');
      async function changeArticleStatus(status, cookie = owner.cookie) {
        return fetch(origin + `/api/articles/${article.data.id}/status`, {
          method: 'PATCH',
          headers: { Cookie: cookie || '', 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
      }
      for (const status of ['Review', 'Published', 'Draft']) {
        const response = await changeArticleStatus(status);
        assert.equal(response.status, 200);
        const changed = await response.json();
        assert.equal(changed.status, status);
        assert.equal(changed.body, updated.body);
        assert.equal(changed.base, base.id);
      }
      assert.equal((await changeArticleStatus('Invalid')).status, 400);
      assert.equal((await changeArticleStatus('Published', other.cookie)).status, 404);
      assert.equal((await changeArticleStatus('Published', null)).status, 401);
      assert.equal(
        (await call('/api/articles', owner.cookie, { ...input, status: 'Invalid' })).status,
        400,
      );
      const selectedTopic = await call('/api/topics', owner.cookie, {
        name: 'Getting started',
        description: '',
        articleIds: [article.data.id],
      });
      assert.equal(selectedTopic.status, 201);
      assert.ok(
        (await call(`/api/articles/${article.data.id}`, owner.cookie)).data.topicIds.includes(
          selectedTopic.data.id,
        ),
      );
      const editTopic = async (cookie, articleIds) =>
        fetch(origin + `/api/topics/${selectedTopic.data.id}`, {
          method: 'PATCH',
          headers: { Cookie: cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Updated topic', description: 'Edited', articleIds }),
        });
      assert.equal((await editTopic(owner.cookie, [])).status, 200);
      assert.equal(
        (await call(`/api/articles/${article.data.id}`, owner.cookie)).data.topicIds.includes(
          selectedTopic.data.id,
        ),
        false,
      );
      assert.equal((await editTopic(other.cookie, [])).status, 404);
      const event = { kind: 'article', documentId: article.data.id, eventId: randomUUID() };
      assert.equal((await call('/api/knowledge/views', owner.cookie, event)).status, 201);
      assert.equal((await call('/api/knowledge/views', owner.cookie, event)).status, 201);
      assert.equal(
        (await call('/api/knowledge/views', other.cookie, { ...event, eventId: randomUUID() }))
          .status,
        404,
      );
      assert.equal((await call('/api/knowledge/views', null, event)).status, 401);
      const overview = await call('/api/knowledge/overview?days=30', owner.cookie);
      assert.equal(overview.status, 200);
      assert.equal(overview.data.summary.views, 1);
      assert.equal(overview.data.summary.agentQueries, 0);
      assert.equal(overview.data.summary.retrievalRate, 0);
      assert.equal(overview.data.mostViewed[0].label, 'Updated access policy');
      assert.equal(overview.data.daily.length, 30);
      assert.equal(overview.data.summary.topics, 2);
      const otherOverview = await call('/api/knowledge/overview?days=7', other.cookie);
      assert.equal(otherOverview.data.summary.views, 0);
      assert.equal(otherOverview.data.summary.agentQueries, 0);
      assert.equal(JSON.stringify(otherOverview.data).includes('Updated access policy'), false);
      assert.equal((await call('/api/knowledge/overview?days=abc', owner.cookie)).status, 400);
      const guest = await call('/api/knowledge/overview');
      assert.equal(guest.status, 401);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await cleanup.db(database).dropDatabase();
      await cleanup.close();
    }
  },
);
