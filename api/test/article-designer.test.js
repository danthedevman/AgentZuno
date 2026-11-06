import {
  retrieveAssistantKnowledge,
  verifyAssistantKnowledge,
} from '../src/knowledge/assistantKnowledge.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { createApi } from '../src/app.js';
import { articleCandidate } from '../src/knowledge/articleDesigner.js';

test('article proposals parse bounded candidates and strip executable HTML', () => {
  const candidate = articleCandidate({
    title: 'Help',
    body: '<h2>Steps</h2><script>alert(1)</script><p onclick="x()">Safe</p><img src="https://invalid.test/x"><a href="javascript:x()">Link</a>',
  });
  assert.equal(candidate.title, 'Help');
  assert.equal(candidate.body, '<h2>Steps</h2><p>Safe</p><a>Link</a>');
  assert.equal(articleCandidate('```json\n{"title":\n```'), null);
  assert.equal(
    articleCandidate(JSON.stringify({ title: 'x'.repeat(161), body: '<p>Text</p>' })),
    null,
  );
});

test(
  'article preview approval is scoped, explicit, immutable, idempotent and stale-safe',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
    const database = `agentzuno_article_review_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_DATABASE = database;
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db(database);
    const app = createApi();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function call(user, path, method = 'GET', body) {
      const result = await fetch(base + '/api' + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(user ? { cookie: user.cookie, 'X-Workspace-Id': user.workspaceId } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: result.status,
        body: await result.json(),
        cookie: result.headers.get('set-cookie')?.split(';')[0],
      };
    }
    async function register() {
      const result = await call(null, '/auth/register', 'POST', {
        email: `fixture-${randomUUID()}@fixture.test`,
        password: 'Fictional-test-password-123!',
      });
      return { ...result.body.user, cookie: result.cookie };
    }
    try {
      const admin = await register();
      const other = await register();
      const upload = await fetch(base + '/api/helpdesk/article-attachments', {
        method: 'POST',
        headers: {
          cookie: admin.cookie,
          'X-Workspace-Id': admin.workspaceId,
          'Content-Type': 'application/octet-stream',
          'X-File-Name': 'guide.txt',
        },
        body: 'Private attachment fixture',
      });
      assert.equal(upload.status, 201);
      const file = await upload.json();
      const topicId = new ObjectId();
      await db.collection('records').insertOne({
        _id: topicId,
        ownerId: admin.id,
        workspaceId: admin.workspaceId,
        type: 'topic',
        name: 'Device Support',
      });
      const draft = {
        title: 'Device Setup',
        body: '<h2>Start</h2><script>bad()</script><p>Contact support.</p>',
        status: 'Published',
        knowledgeBaseId: admin.workspaceId,
        topicIds: [String(topicId)],
        attachmentIds: [file.id],
      };
      const draftChat = await call(admin, '/helpdesk/article-conversations', 'POST', {
        requestId: randomUUID(),
        text: 'Draft device setup',
        draft: { title: draft.title, body: draft.body },
      });
      assert.equal(draftChat.status, 202);
      const preview = await call(admin, '/helpdesk/article-proposals', 'POST', {
        draft,
        chatId: draftChat.body.id,
        articleId: draftChat.body.articleId,
        expectedUpdatedAt: draftChat.body.articleUpdatedAt,
      });
      assert.equal(preview.status, 201);
      assert.equal(await db.collection('articles').countDocuments({}), 1);
      assert.equal(
        (await db.collection('articles').findOne({ _id: new ObjectId(draftChat.body.articleId) }))
          .status,
        'Draft',
      );
      assert.equal(preview.body.draft.body, '<h2>Start</h2><p>Contact support.</p>');
      assert.equal(
        (await call(other, `/helpdesk/article-proposals/${preview.body.id}`)).status,
        404,
      );
      assert.equal(
        (
          await call(other, `/helpdesk/article-proposals/${preview.body.id}/approve`, 'POST', {
            approved: true,
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await call(admin, `/helpdesk/article-proposals/${preview.body.id}/approve`, 'POST', {
            approved: false,
          })
        ).status,
        400,
      );
      assert.equal(await db.collection('articles').countDocuments({}), 1);
      assert.equal(
        (await db.collection('articles').findOne({ _id: new ObjectId(draftChat.body.articleId) }))
          .status,
        'Draft',
      );
      const saved = await call(
        admin,
        `/helpdesk/article-proposals/${preview.body.id}/approve`,
        'POST',
        { approved: true },
      );
      assert.equal(saved.status, 200);
      assert.equal(saved.body.status, 'Published');
      assert.equal(
        (await db.collection('chats').findOne({ _id: new ObjectId(draftChat.body.id) })).articleId,
        saved.body.id,
      );
      const history = await call(
        admin,
        `/helpdesk/article-conversations?articleId=${saved.body.id}&list=1&sort=Updated&direction=desc`,
      );
      assert.equal(history.status, 200);
      assert.equal(history.body.rows[0].id, draftChat.body.id);
      assert.equal(history.body.rows[0].messages, undefined);
      assert.equal(
        (await call(other, `/helpdesk/article-conversations?articleId=${saved.body.id}`)).status,
        404,
      );
      const mismatched = await call(admin, '/helpdesk/article-proposals', 'POST', {
        draft,
        chatId: draftChat.body.id,
      });
      assert.equal(mismatched.status, 409);
      assert.equal(
        (
          await call(admin, `/helpdesk/article-proposals/${preview.body.id}/approve`, 'POST', {
            approved: true,
          })
        ).body.id,
        saved.body.id,
      );
      assert.equal(await db.collection('articles').countDocuments({}), 1);
      const stale = await call(admin, '/helpdesk/article-proposals', 'POST', {
        articleId: saved.body.id,
        expectedUpdatedAt: saved.body.updatedAt,
        draft: { ...draft, title: 'Proposed change' },
      });
      assert.equal(stale.status, 201);
      await call(admin, `/articles/${saved.body.id}`, 'PATCH', { ...draft, title: 'Newer edit' });
      assert.equal(
        (
          await call(admin, `/helpdesk/article-proposals/${stale.body.id}/approve`, 'POST', {
            approved: true,
          })
        ).status,
        409,
      );
      assert.equal(
        (await db.collection('articles').findOne({ _id: new ObjectId(saved.body.id) })).title,
        'Newer edit',
      );
      const chat = await call(admin, '/helpdesk/article-conversations', 'POST', {
        requestId: randomUUID(),
        articleId: saved.body.id,
        text: 'Clarify the article',
        draft: { title: saved.body.title, body: saved.body.body },
      });
      assert.equal(chat.status, 202);
      const original = await db.collection('chats').findOne({ _id: new ObjectId(chat.body.id) });
      assert.equal(original.assistantType, 'admin');
      assert.equal(original.helpdeskPurpose, 'article');
      await db.collection('chats').updateOne(
        { _id: original._id },
        {
          $set: {
            status: 'complete',
            'messages.1.status': 'complete',
            'messages.1.text': 'Review the proposed article.',
            'messages.1.proposals.article': {
              kind: 'article',
              title: 'AI proposal',
              body: '<p>Suggested text</p>',
            },
          },
        },
      );
      const proposed = await call(admin, `/helpdesk/article-conversations/${chat.body.id}`);
      assert.equal(proposed.body.candidate.title, 'AI proposal');
      assert.equal(
        (await db.collection('articles').findOne({ _id: new ObjectId(saved.body.id) })).title,
        'Newer edit',
      );
      assert.equal(
        (await call(other, `/helpdesk/article-conversations/${chat.body.id}`)).status,
        404,
      );
      assert.equal(
        (await call(null, `/helpdesk/article-proposals/${preview.body.id}`)).status,
        401,
      );
      const employee = await register();
      await db.collection('helpdeskMembers').insertOne({
        ownerId: admin.id,
        workspaceId: admin.workspaceId,
        userId: employee.id,
        role: 'user',
        active: true,
        queues: [],
        canApprove: false,
      });
      const member = { ...employee, workspaceId: admin.workspaceId };
      assert.equal((await call(member, '/helpdesk/knowledge-center')).body.bases.length, 0);
      assert.equal(
        (await call(member, '/helpdesk/knowledge-center?q=Newer')).body.articles.total,
        0,
      );
      const basePolicy = await call(
        admin,
        `/helpdesk/knowledge-permissions/base/${admin.workspaceId}`,
        'PUT',
        { mode: 'workspace', userIds: [], roles: [], version: 0 },
      );
      assert.equal(basePolicy.status, 200);
      const center = await call(member, `/helpdesk/knowledge-center?base=${admin.workspaceId}`);
      assert.equal(center.status, 200);
      assert.equal(center.body.articles.rows[0].id, saved.body.id);
      const globalSearch = await call(member, '/helpdesk/knowledge-center?q=Newer');
      assert.equal(globalSearch.body.articles.rows[0].id, saved.body.id);
      assert.equal(center.body.bases[0].articles[0].id, saved.body.id);
      const reader = await call(member, `/helpdesk/knowledge-center?article=${saved.body.id}`);
      assert.equal(reader.status, 200);
      assert.equal(reader.body.title, 'Newer edit');
      const downloaded = await fetch(
        base + `/api/helpdesk/article-attachments/${file.id}?article=${saved.body.id}`,
        { headers: { cookie: employee.cookie, 'X-Workspace-Id': admin.workspaceId } },
      );
      assert.equal(downloaded.status, 200);
      assert.match(downloaded.headers.get('content-disposition'), /^attachment;/);
      assert.equal(await downloaded.text(), 'Private attachment fixture');
      assert.equal(
        (
          await fetch(
            base + `/api/helpdesk/article-attachments/${file.id}?article=${saved.body.id}`,
            { headers: { cookie: other.cookie, 'X-Workspace-Id': other.workspaceId } },
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await call(member, `/helpdesk/knowledge-permissions/article/${saved.body.id}`, 'PUT', {
            mode: 'workspace',
            userIds: [],
            roles: [],
            version: 0,
          })
        ).status,
        403,
      );
      const chatContext = {
        ownerId: employee.id,
        providerOwnerId: admin.id,
        workspaceId: admin.workspaceId,
        messages: [{ role: 'user', text: 'Newer edit support' }],
      };
      const retrievalStore = { collection: (name) => db.collection(name), ready: async () => {} };
      const references = await retrieveAssistantKnowledge(retrievalStore, chatContext);
      assert.equal(references.length, 1);
      const restriction = await call(
        admin,
        `/helpdesk/knowledge-permissions/article/${saved.body.id}`,
        'PUT',
        { mode: 'restricted', userIds: [], roles: [], version: 0 },
      );
      assert.equal(restriction.status, 200);
      assert.equal(
        (await call(member, `/helpdesk/knowledge-center?article=${saved.body.id}`)).status,
        404,
      );
      assert.equal((await retrieveAssistantKnowledge(retrievalStore, chatContext)).length, 0);
      await assert.rejects(verifyAssistantKnowledge(retrievalStore, chatContext, references));
      assert.equal(
        (
          await fetch(
            base + `/api/helpdesk/article-attachments/${file.id}?article=${saved.body.id}`,
            { headers: { cookie: employee.cookie, 'X-Workspace-Id': admin.workspaceId } },
          )
        ).status,
        404,
      );
      const audit = await call(
        admin,
        '/helpdesk/audit?list=1&pageSize=20&sort=Time&direction=desc',
      );
      assert.equal(audit.status, 200);
      assert.equal(audit.body.pageSize, 20);
      assert.ok(audit.body.total > 0);
      assert.ok(
        await db.collection('governanceAudit').findOne({
          ownerId: admin.id,
          workspaceId: admin.workspaceId,
          action: 'articles.updateOne',
        }),
      );
      assert.equal(
        JSON.stringify(await db.collection('governanceAudit').find({}).toArray()).includes(
          'Private attachment fixture',
        ),
        false,
      );
      assert.equal(
        (
          await call(admin, `/helpdesk/knowledge-permissions/article/${saved.body.id}`, 'PUT', {
            mode: 'workspace',
            userIds: [],
            roles: [],
            version: 0,
          })
        ).status,
        409,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.close();
      await db.dropDatabase();
      await client.close();
    }
  },
);
