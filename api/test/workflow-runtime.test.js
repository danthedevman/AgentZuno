import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { toTypeScript } from '../sdk/workflows/index.js';
import {
  runSandbox,
  inspectWorkflowSource,
  updateWorkflowMetadata,
} from '../src/workflowRuntime.js';
import { createWorkflowExecution } from '../src/workflowExecution.js';
import { createHelpdeskWorkflows } from '../src/helpdeskWorkflows.js';
import { createIntegrationStore } from '../src/integrationStore.js';
import { encryptSecret } from '../src/secrets.js';
const definition = {
  version: 1,
  name: 'Laptop Order',
  trigger: { department: 'it', phrases: ['mac'] },
  steps: [{ id: 'route', action: 'route', params: { queueName: 'Desktop Support' } }],
};
const generated = toTypeScript(definition);
test('executable TypeScript is type checked, isolated, bounded and actually controls routing', async () => {
  assert.equal((await inspectWorkflowSource(generated)).name, definition.name);
  const source = generated.replace(
    'await ctx.route("route", "Desktop Support");',
    'if (ctx.answers.platform === "Mac") await ctx.route("route", "Desktop Support");',
  );
  const calls = [];
  await runSandbox(source, {
    input: { answers: { platform: 'Windows' } },
    action: async (step) => calls.push(step),
  });
  assert.equal(calls.length, 0);
  await runSandbox(source, {
    input: { answers: { platform: 'Mac' } },
    action: async (step) => {
      calls.push(step);
      return {};
    },
  });
  assert.equal(calls.length, 1);
  await assert.rejects(
    inspectWorkflowSource(generated.replace('await ctx.route', 'await ctx.nonexistent')),
    /TypeScript/,
  );
  await assert.rejects(
    inspectWorkflowSource(generated.replace("'@agentzuno/workflows'", "'node:fs'")),
    /Only/,
  );
  await assert.rejects(
    runSandbox(
      generated.replace('await ctx.route("route", "Desktop Support");', 'while (true) {}'),
    ),
    /failed|limit/,
  );
  const access = generated.replace(
    'await ctx.route("route", "Desktop Support");',
    'const hidden = globalThis["process" as keyof typeof globalThis]; if (hidden) throw new Error("Host leaked"); await ctx.route("route", "Desktop Support");',
  );
  await runSandbox(access, { action: async () => ({}) });
  const edited = updateWorkflowMetadata(source, { ...definition, name: 'New Name' });
  assert.equal((await inspectWorkflowSource(edited)).name, 'New Name');
  assert.ok(edited.includes('ctx.answers.platform'));
  const retargeted = updateWorkflowMetadata(source, {
    ...definition,
    steps: [{ id: 'route', action: 'route', params: { queueName: 'Mac Support' } }],
    settings: { timeoutSeconds: 5, maxConcurrentRuns: 1 },
  });
  assert.ok(retargeted.includes('ctx.answers.platform'));
  const retargetedCalls = [];
  await runSandbox(retargeted, {
    input: { answers: { platform: 'Mac' } },
    action: async (step) => {
      retargetedCalls.push(step);
      return {};
    },
  });
  assert.equal(retargetedCalls[0].input.queueName, 'Mac Support');
  assert.equal((await inspectWorkflowSource(retargeted)).settings.timeoutSeconds, 5);
  await assert.rejects(
    inspectWorkflowSource(
      generated.replace(
        '"name": "Laptop Order"',
        '"settings": { "timeoutSeconds": 100 }, "name": "Laptop Order"',
      ),
    ),
    /limit/,
  );
});

test(
  'durable workflow runs isolate workspaces, enforce action grants, replay safely and resume approvals',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const uri = process.env.TEST_MONGODB_URI;
    const database = `agentzuno_runtime_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_DATABASE = database;
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const store = createIntegrationStore();
    const client = new MongoClient(uri);
    const workspaceId = new ObjectId().toHexString();
    const scope = { ownerId: 'owner', workspaceId };
    const admin = { id: 'owner', workspaceId, role: 'admin' };
    const employee = { id: 'employee', workspaceId, helpdeskOwnerId: 'owner', role: 'user' };
    let posts = 0;
    const executor = createWorkflowExecution(store, async (url) => {
      if (url.includes('conversations.info'))
        return Response.json({ ok: true, channel: { is_member: true } });
      posts++;
      return Response.json({ ok: true, ts: '1700000000.001' });
    });
    try {
      await store.ready();
      await store.collection('users').insertMany([
        { id: 'owner', workspaceId },
        { id: 'employee', workspaceId: new ObjectId().toHexString() },
        { id: 'approver', workspaceId: new ObjectId().toHexString() },
      ]);
      await store.collection('helpdeskMembers').insertMany([
        { ...scope, userId: 'employee', active: true, role: 'user', queues: [] },
        {
          ...scope,
          userId: 'approver',
          active: true,
          role: 'agent',
          canApprove: true,
          queues: ['Desktop Support'],
        },
      ]);
      await store.collection('helpdeskQueues').insertOne({ ...scope, name: 'Desktop Support' });
      await store.collection('helpdeskChannels').insertOne({
        ...scope,
        provider: 'slack',
        slackScopeVersion: 1,
        credential: encryptSecret(JSON.stringify({ accessToken: 'fictional-test-token' })),
      });
      const manifest = {
        ...definition,
        steps: [
          definition.steps[0],
          {
            id: 'approve',
            action: 'approval',
            requireRejectionComment: true,
            params: { reason: 'Review laptop' },
          },
          {
            id: 'notify',
            action: 'slack.postMessage',
            params: { channel: 'C123', text: 'Laptop requested' },
          },
        ],
      };
      let source = toTypeScript(manifest).replace('SELECT_APPROVER_USER_ID', 'approver');
      const service = createHelpdeskWorkflows(store, {});
      const input = {
        source,
        name: manifest.name,
        department: 'it',
        keywords: ['mac'],
        action: 'route',
        queueName: 'Desktop Support',
        enabled: true,
        intent: 'publish',
      };
      const workflow = await service.save(admin, null, input);
      const request = {
        ...scope,
        requesterId: 'employee',
        workflowId: workflow.id,
        workflowVersion: 1,
        submissionState: 'submitted',
        requestId: randomUUID(),
        number: 'REQ-1',
        title: 'Mac',
        queueName: 'Initial',
        version: 1,
        events: [],
      };
      request._id = (await store.collection('helpdeskRequests').insertOne(request)).insertedId;
      const id = await executor.ensureRun(request);
      assert.equal(await executor.ensureRun(request), id);
      await store.collection('workflowConcurrency').insertMany(
        [0, 1].map((slot) => ({
          _id: `${scope.ownerId}:${scope.workspaceId}:${workflow.id}:${slot}`,
          lease: 'held',
          leaseUntil: new Date(Date.now() + 60000),
        })),
      );
      await executor.process(id);
      assert.equal((await store.collection('workflowRuns').findOne({ _id: id })).status, 'queued');
      await store.collection('workflowConcurrency').deleteMany({ lease: 'held' });
      await executor.process(id);
      let run = await store.collection('workflowRuns').findOne({ _id: id });
      assert.equal(run.status, 'awaiting-approval');
      assert.equal(posts, 0);
      await assert.rejects(executor.decide({ ...admin, canApprove: true }, id, 'approve', true), {
        status: 404,
      });
      await assert.rejects(
        executor.decide(
          { id: 'approver', ...scope, helpdeskOwnerId: 'owner', role: 'agent', canApprove: true },
          id,
          'approve',
          false,
        ),
        { status: 400 },
      );
      await executor.decide(
        { id: 'approver', ...scope, helpdeskOwnerId: 'owner', role: 'agent', canApprove: true },
        id,
        'approve',
        true,
      );
      await executor.process(id);
      await executor.process(id);
      run = await store.collection('workflowRuns').findOne({ _id: id });
      assert.equal(run.status, 'complete');
      assert.equal(posts, 1);
      assert.equal(
        (await store.collection('helpdeskRequests').findOne({ _id: request._id })).events.length,
        1,
      );
      assert.ok(
        await store
          .collection('governanceAudit')
          .countDocuments({ ...scope, action: 'workflow.slack.postMessage' }),
      );
      await assert.rejects(
        service.save(admin, null, {
          ...input,
          source: generated.replaceAll('Desktop Support', 'Does Not Exist'),
        }),
        /existing queue/,
      );
      const preview = await executor.test(admin, source, manifest, {});
      assert.equal(preview.status, 'Simulated');
      assert.equal(posts, 1);
      await assert.rejects(executor.test(employee, source, manifest, {}), { status: 403 });
      const unknown = { ...request, requestId: randomUUID(), _id: new ObjectId(), number: 'REQ-2' };
      await store.collection('helpdeskRequests').insertOne(unknown);
      const unknownId = await executor.ensureRun(unknown);
      await store.collection('workflowRuns').updateOne(
        { _id: unknownId },
        {
          $set: {
            steps: [
              {
                id: 'route',
                action: 'route',
                input: { queueName: 'Desktop Support' },
                fingerprint: 'wrong',
                status: 'complete',
                result: {},
              },
            ],
          },
        },
      );
      await executor.process(unknownId);
      assert.equal(
        (await store.collection('workflowRuns').findOne({ _id: unknownId })).status,
        'failed',
      );
      await store
        .collection('helpdeskWorkflows')
        .updateOne({ _id: new ObjectId(workflow.id) }, { $set: { enabled: false } });
      const blocked = { ...request, _id: new ObjectId() };
      assert.equal(await executor.ensureRun(blocked), null);
    } finally {
      await store.close();
      await client.db(database).dropDatabase();
      await client.close();
    }
  },
);
