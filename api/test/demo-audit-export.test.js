import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { createApi } from '../src/app.js';

test(
  'demo controls, export events and audit details enforce current workspace and effective roles',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
    const database = `agentzuno_demo_audit_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_DATABASE = database;
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db(database),
      app = createApi(),
      server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function call(actor, path, method = 'GET', body) {
      const result = await fetch(base + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(actor ? { cookie: actor.cookie, 'X-Workspace-Id': actor.workspaceId } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: result.status,
        body: await result.json(),
        cookie: result.headers.get('set-cookie')?.split(';')[0],
      };
    }
    async function register(name) {
      const result = await call(null, '/auth/register', 'POST', {
        email: `${name}@demo-fixture.test`,
        password: 'Fictional-demo-password!',
      });
      assert.equal(result.status, 201);
      return { ...result.body.user, cookie: result.cookie };
    }
    try {
      const admin = await register('admin'),
        other = await register('other');
      assert.equal((await call(admin, '/helpdesk/demo/settings')).body.loaded, false);
      assert.equal(
        (
          await call(admin, '/helpdesk/demo/settings', 'PUT', {
            action: 'load',
            enableApprovals: true,
            industry: 'retail',
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await call(admin, '/helpdesk/demo/settings', 'PUT', {
            action: 'load',
            enableApprovals: true,
            industry: 'retail',
          })
        ).status,
        200,
      );
      assert.equal((await call(other, '/helpdesk/demo/settings')).body.loaded, false);
      assert.equal(
        await db.collection('helpdeskRequests').countDocuments({ ownerId: admin.id }),
        4,
      );
      assert.equal(await db.collection('helpdeskTasks').countDocuments({ ownerId: admin.id }), 4);
      const workflows = await call(admin, '/helpdesk/workflows');
      assert.equal(workflows.status, 200);
      assert.equal(workflows.body.length, 4);
      const inbox = await call(admin, '/helpdesk/inbox');
      assert.equal(inbox.status, 200);
      assert.ok(inbox.body.some((item) => item.status === 'waiting-for-approval'));
      const history = await call(
        admin,
        `/helpdesk/workflow-conversations?workflowId=${workflows.body[0].id}`,
      );
      assert.equal(history.body.length, 1);
      assert.match(history.body[0].title, /Build/i);
      assert.equal(
        (await call(admin, `/helpdesk/workflows/${workflows.body[0].id}/view`)).body.chatId,
        history.body[0].id,
      );
      assert.equal(
        (
          await call(admin, `/helpdesk/workflows/${workflows.body[0].id}/view`, 'PUT', {
            chatId: null,
          })
        ).status,
        200,
      );
      assert.equal(
        (await call(admin, `/helpdesk/workflows/${workflows.body[0].id}/view`)).body.chatId,
        null,
      );
      assert.equal(
        (
          await call(admin, `/helpdesk/workflows/${workflows.body[0].id}/view`, 'PUT', {
            chatId: history.body[0].id,
          })
        ).status,
        200,
      );
      assert.equal(
        (await call(other, `/helpdesk/workflows/${workflows.body[0].id}/view`)).status,
        404,
      );
      assert.ok(workflows.body.every((item) => item.name.startsWith('Demo:')));
      assert.equal(
        await db.collection('articles').countDocuments({ ownerId: admin.id, status: 'Published' }),
        3,
      );
      assert.equal(
        (
          await call(admin, '/helpdesk/demo/settings', 'PUT', {
            action: 'load',
            enableApprovals: true,
            industry: 'tech',
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await call(admin, '/helpdesk/demo/settings', 'PUT', {
            action: 'remove',
            industry: 'retail',
          })
        ).status,
        400,
      );
      const conversation = await call(admin, '/helpdesk/support/conversations', 'POST', {
        requestId: randomUUID(),
        workflowId: workflows.body[0].id,
      });
      assert.equal(conversation.status, 202);
      const opened = await call(admin, `/helpdesk/support/conversations/${conversation.body.id}`);
      const form = opened.body.requestForm;
      const answers = Object.fromEntries(
        form.fields.map((field) => [
          field.id,
          field.type === 'boolean'
            ? false
            : field.type === 'select'
              ? field.options[0]
              : 'Demo request details',
        ]),
      );
      const submitted = await call(
        admin,
        `/helpdesk/support/conversations/${conversation.body.id}/form`,
        'POST',
        {
          workflowId: form.workflowId,
          workflowVersion: form.workflowVersion,
          offerId: form.offerId,
          answers,
        },
      );
      assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
      assert.equal(
        (
          await db
            .collection('helpdeskRequests')
            .findOne({ ownerId: admin.id, chatId: conversation.body.id })
        ).demoDatasetId,
        'demo-v1-retail',
      );
      const demoWorkflow = await db
        .collection('helpdeskWorkflows')
        .findOne({ ownerId: admin.id, demoDatasetId: { $exists: true } });
      const demoAsset = await db.collection('workforceReferences').findOne({
        ownerId: admin.id,
        type: 'asset',
        demoDatasetId: { $exists: true },
      });
      const assetId = String(demoAsset._id);
      assert.ok(
        !(await call(admin, '/helpdesk/data/tables/ref-asset/options')).body.some(
          (item) => item.value === assetId,
        ),
      );
      assert.ok(
        (await call(admin, '/helpdesk/data/tables/ref-asset/options?includeDemo=1')).body.some(
          (item) => item.value === assetId,
        ),
      );
      const blocked = await call(admin, '/helpdesk/workflows', 'POST', {
        source: demoWorkflow.source,
        enabled: false,
      });
      assert.equal(blocked.status, 400, JSON.stringify(blocked.body));
      assert.match(blocked.body.error, /Demo records/);
      // Legacy references remain valid without rewriting published source or revisions.
      const legacy = { ...demoWorkflow, _id: new ObjectId(), name: 'Real Legacy Workflow' };
      delete legacy.demo;
      delete legacy.demoDatasetId;
      delete legacy.demoIndustry;
      await db.collection('helpdeskWorkflows').insertOne(legacy);
      await db.collection('adminDataRecords').insertOne({
        ownerId: admin.id,
        workspaceId: admin.workspaceId,
        tableId: new ObjectId().toHexString(),
        values: { asset: assetId },
      });
      const preview = await call(admin, '/helpdesk/demo/removal-preview');
      assert.equal(preview.status, 200);
      assert.ok(preview.body.retained.some((item) => item.type === 'approvalGroups'));
      assert.ok(preview.body.retained.some((item) => item.type === 'workforceReferences'));
      await db.collection('workforceReferences').insertOne({
        ownerId: admin.id,
        workspaceId: admin.workspaceId,
        type: 'asset',
        name: 'Real Asset',
      });
      assert.equal(
        (
          await call(admin, '/helpdesk/demo/settings', 'PUT', {
            action: 'remove',
            industry: 'retail',
            confirmed: true,
          })
        ).status,
        200,
      );
      assert.equal(
        await db.collection('helpdeskRequests').countDocuments({ ownerId: admin.id }),
        0,
      );
      assert.equal(await db.collection('articles').countDocuments({ ownerId: admin.id }), 0);
      assert.equal(await db.collection('helpdeskTasks').countDocuments({ ownerId: admin.id }), 0);
      assert.equal(
        await db
          .collection('workforceReferences')
          .countDocuments({ ownerId: admin.id, name: 'Real Asset' }),
        1,
      );
      assert.equal(
        await db.collection('authoredSemanticRetirements').countDocuments({ ownerId: admin.id }),
        3,
      );
      assert.ok(
        await db
          .collection('chats')
          .findOne({ ownerId: admin.id, _id: new ObjectId(conversation.body.id) }),
      );
      const memberAfterRemoval = await db
        .collection('helpdeskMembers')
        .findOne({ ownerId: admin.id, userId: admin.id });
      assert.equal(memberAfterRemoval.canApprove, false);
      assert.ok(memberAfterRemoval.queues.includes(demoWorkflow.queueName));
      const unchanged = await db.collection('helpdeskWorkflows').findOne({ _id: legacy._id });
      assert.equal(unchanged.source, legacy.source);
      assert.deepEqual(unchanged.publishedConfig, legacy.publishedConfig);
      const retainedAsset = await db.collection('workforceReferences').findOne({ _id: assetId });
      assert.ok(retainedAsset.retainedFromDemo);
      assert.equal(retainedAsset.demoDatasetId, undefined);
      assert.equal((await call(admin, '/helpdesk/demo/settings')).body.loaded, false);
      assert.equal(
        (
          await call(admin, '/helpdesk/demo/settings', 'PUT', {
            action: 'load',
            industry: 'retail',
            enableApprovals: true,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await call(admin, '/helpdesk/demo/settings', 'PUT', {
            action: 'remove',
            industry: 'retail',
            confirmed: true,
          })
        ).status,
        200,
      );
      assert.ok(await db.collection('workforceReferences').findOne({ _id: assetId }));
      const actions = { receiveMessages: true, respondToUsers: true, workflowNotifications: false };
      assert.equal(
        (await call(admin, '/helpdesk/channels/slack/actions', 'PUT', { version: 0, actions }))
          .status,
        200,
      );
      assert.equal(
        (
          await call(admin, '/helpdesk/exports', 'POST', {
            format: 'csv',
            count: 3,
            source: '/api/helpdesk/my-work',
          })
        ).status,
        200,
      );
      const event = await db.collection('governanceAudit').findOne({ action: 'export.csv' });
      assert.equal((await call(admin, `/helpdesk/audit/${event._id}`)).body.recordCount, 3);
      assert.equal((await call(other, `/helpdesk/audit/${event._id}`)).status, 404);
      assert.equal(
        (await call(admin, `/helpdesk/audit/${event._id}/events?list=1&sort=Time`)).status,
        200,
      );
      await call(admin, '/auth/impersonation', 'POST', {
        role: 'read-only',
        workspaceId: admin.workspaceId,
      });
      assert.equal((await call(admin, `/helpdesk/audit/${event._id}`)).status, 200);
      assert.equal(
        (
          await call(admin, '/helpdesk/demo/settings', 'PUT', {
            action: 'remove',
            industry: 'retail',
            confirmed: true,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await call(admin, '/helpdesk/exports', 'POST', {
            format: 'json',
            count: 1,
            source: '/api/helpdesk/audit',
          })
        ).status,
        200,
      );
      assert.equal(
        (await call(admin, '/helpdesk/channels/slack/actions', 'PUT', { version: 1, actions }))
          .status,
        403,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.close();
      await db.dropDatabase();
      await client.close();
    }
  },
);
