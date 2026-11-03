import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { createApi } from '../src/app.js';
import { createIntegrationStore } from '../src/integrationStore.js';
import { createChatService } from '../src/chat.js';

const uri = process.env.TEST_MONGODB_URI;
test(
  'Admin, Agent and User roles enforce membership, queues, approvals and immediate revocation',
  { skip: !uri },
  async () => {
    process.env.MONGODB_URI = uri;
    const database = `agentzuno_roles_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_DATABASE = database;
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const cleanup = new MongoClient(uri);
    const app = createApi();
    const store = createIntegrationStore();
    const pending = [];
    let modelCalls = 0;
    let duringGeneration = async () => {};
    const chats = createChatService(
      store,
      async (job) => pending.push(job),
      async (url, options) => {
        modelCalls++;
        assert.equal(url, 'https://api.openai.com/v1/responses');
        assert.equal(options.headers.Authorization, 'Bearer fixture-role-provider-key');
        await duringGeneration();
        return new Response(
          JSON.stringify({
            output: [{ content: [{ type: 'output_text', text: 'Draft for review.' }] }],
          }),
        );
      },
    );
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function call(actor, path, method = 'GET', body, workspaceId) {
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(actor ? { cookie: actor.cookie } : {}),
          ...(workspaceId ? { 'x-workspace-id': workspaceId } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    }
    async function register(email) {
      const response = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'Fictional-roles-password!' }),
      });
      assert.equal(response.status, 201);
      const result = await response.json();
      assert.equal(result.user.role, 'admin');
      return { ...result.user, cookie: response.headers.get('set-cookie').split(';')[0] };
    }
    try {
      const admin = await register('admin@roles.test');
      const agent = await register('agent@roles.test');
      const employee = await register('user@roles.test');
      const workspace = admin.workspaceId;
      const adminCall = (path, method, body) => call(admin, path, method, body, workspace);
      const agentCall = (path, method, body) => call(agent, path, method, body, workspace);
      const userCall = (path, method, body) => call(employee, path, method, body, workspace);
      await adminCall('/helpdesk/queues', 'POST', {
        name: 'it',
        description: '',
        routingInstructions: '',
        agentIds: [],
      });
      assert.equal((await agentCall('/helpdesk/requests')).status, 403);
      await store.collection('identitySettings').insertOne({
        ownerId: admin.id,
        workspaceId: workspace,
        enabled: true,
      });
      const managedMembership = {
        email: employee.email,
        role: 'user',
        queues: [],
        active: true,
        canApprove: false,
      };
      assert.equal((await adminCall('/helpdesk/members', 'POST', managedMembership)).status, 409);
      assert.equal(
        await store.collection('helpdeskMembers').countDocuments({
          workspaceId: workspace,
          userId: employee.id,
        }),
        0,
      );
      await store
        .collection('identitySettings')
        .deleteOne({ ownerId: admin.id, workspaceId: workspace });
      assert.equal(
        (
          await adminCall('/helpdesk/members', 'POST', {
            email: agent.email,
            role: 'agent',
            queues: ['it'],
            active: true,
            canApprove: false,
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await adminCall('/helpdesk/members', 'POST', {
            email: employee.email,
            role: 'user',
            queues: [],
            active: true,
            canApprove: false,
          })
        ).status,
        201,
      );
      assert.equal((await agentCall('/helpdesk/access')).body.role, 'agent');
      assert.equal((await userCall('/helpdesk/access')).body.role, 'user');
      const create = (department, requestId = randomUUID()) => ({
        title: 'Employee request',
        text: 'Please help me.',
        requestId,
        department,
      });
      const own = await userCall('/helpdesk/requests', 'POST', create('it'));
      assert.equal(own.status, 201);
      const ownId = own.body.id;
      const hidden = await adminCall('/helpdesk/requests', 'POST', create('hr'));
      assert.equal((await userCall(`/helpdesk/requests/${hidden.body.id}`)).status, 404);
      assert.equal((await agentCall(`/helpdesk/requests/${hidden.body.id}`)).status, 404);
      assert.equal((await userCall('/helpdesk/requests')).body.length, 1);
      assert.equal((await agentCall('/helpdesk/requests')).body.length, 1);
      assert.equal((await adminCall('/helpdesk/requests')).body.length, 2);
      const personalRequest = await agentCall('/helpdesk/requests', 'POST', create('hr'));
      assert.equal(personalRequest.status, 201);
      assert.equal((await agentCall(`/helpdesk/requests/${personalRequest.body.id}`)).status, 200);
      assert.equal(
        (
          await agentCall(`/helpdesk/requests/${personalRequest.body.id}/messages`, 'POST', {
            version: 1,
            text: 'Requester follow-up.',
          })
        ).body.messages.at(-1).role,
        'requester',
      );
      assert.equal(
        (
          await agentCall(`/helpdesk/requests/${personalRequest.body.id}`, 'PATCH', {
            version: 2,
            status: 'resolved',
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await agentCall(`/helpdesk/requests/${personalRequest.body.id}/drafts`, 'POST', {
            requestId: randomUUID(),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await adminCall('/helpdesk/members', 'POST', {
            email: employee.email,
            role: 'owner',
            queues: [],
            active: true,
            canApprove: false,
          })
        ).status,
        400,
      );

      assert.equal(
        (await userCall(`/helpdesk/requests/${ownId}`, 'PATCH', { version: 1, status: 'resolved' }))
          .status,
        403,
      );
      assert.equal(
        (
          await userCall(`/helpdesk/requests/${ownId}/messages`, 'POST', {
            version: 1,
            text: 'More details.',
          })
        ).body.messages.at(-1).role,
        'requester',
      );
      assert.equal(
        (
          await agentCall(`/helpdesk/requests/${ownId}/messages`, 'POST', {
            version: 2,
            text: 'Investigating.',
          })
        ).status,
        200,
      );
      assert.equal(
        (await agentCall(`/helpdesk/requests/${ownId}`, 'PATCH', { version: 3, department: 'hr' }))
          .status,
        403,
      );
      const approval = await agentCall(`/helpdesk/requests/${ownId}/approvals`, 'POST', {
        version: 3,
        action: 'access-request',
        reason: 'Review required.',
      });
      assert.equal(approval.status, 200);
      const decision = {
        version: 4,
        approvalId: approval.body.approvals[0].id,
        decision: 'approved',
      };
      assert.equal(
        (await agentCall(`/helpdesk/requests/${ownId}/approval-decisions`, 'POST', decision))
          .status,
        403,
      );
      assert.equal(
        (await adminCall(`/helpdesk/requests/${ownId}/approval-decisions`, 'POST', decision))
          .status,
        403,
      );
      const approvedAgent = await adminCall(`/helpdesk/members/${agent.id}`, 'PUT', {
        role: 'agent',
        queues: ['it'],
        active: true,
        canApprove: true,
        version: 1,
      });
      assert.equal(approvedAgent.status, 200);
      await chats.ai.save(
        { id: admin.id, workspaceId: workspace },
        {
          provider: 'openai',
          model: 'gpt-6.1-sol',
          instructions: 'Draft helpful support replies.',
          maxOutputTokens: 4096,
          reasoning: 'medium',
          enabled: true,
          isDefault: true,
          apiKey: 'fixture-role-provider-key',
        },
      );
      const context = {
        providerOwnerId: admin.id,
        helpdeskPurpose: 'request-draft',
        helpdeskRequestId: ownId,
      };
      const validDraft = await chats.create(
        { id: agent.id, workspaceId: workspace },
        { text: 'Draft reply', requestId: randomUUID() },
        context,
      );
      await chats.process(pending.shift());
      assert.equal(
        (await chats.get({ id: agent.id, workspaceId: workspace }, validDraft.id)).status,
        'complete',
      );
      assert.equal(modelCalls, 1);
      duringGeneration = () =>
        store
          .collection('helpdeskMembers')
          .updateOne({ workspaceId: workspace, userId: agent.id }, { $set: { active: false } });
      const interruptedDraft = await chats.create(
        { id: agent.id, workspaceId: workspace },
        { text: 'Draft reply', requestId: randomUUID() },
        context,
      );
      await chats.process(pending.shift());
      const interrupted = await chats.get(
        { id: agent.id, workspaceId: workspace },
        interruptedDraft.id,
      );
      assert.equal(interrupted.status, 'failed');
      assert.equal(interrupted.messages.at(-1).text, '');
      await store
        .collection('helpdeskMembers')
        .updateOne({ workspaceId: workspace, userId: agent.id }, { $set: { active: true } });
      duringGeneration = async () => {};
      const queuedDraft = await chats.create(
        { id: agent.id, workspaceId: workspace },
        { text: 'Draft a support reply', requestId: randomUUID() },
        { providerOwnerId: admin.id, helpdeskPurpose: 'request-draft', helpdeskRequestId: ownId },
      );
      await assert.rejects(
        chats.create(
          { id: agent.id, workspaceId: workspace },
          {
            text: 'Different request',
            requestId: (await store.collection('chats').findOne({ ownerId: agent.id })).requestId,
          },
          { providerOwnerId: admin.id, helpdeskPurpose: 'workflow' },
        ),
        { status: 409 },
      );

      assert.equal(
        (await agentCall(`/helpdesk/requests/${ownId}/approval-decisions`, 'POST', decision))
          .status,
        200,
      );
      for (const actorCall of [agentCall, userCall]) {
        for (const path of [
          '/helpdesk/settings',
          '/helpdesk/workflows',
          '/helpdesk/members',
          '/helpdesk/audit',
        ])
          assert.equal((await actorCall(path)).status, 403);
        assert.equal(
          (
            await actorCall('/helpdesk/workflow-conversations', 'POST', {
              text: 'Route VPN requests',
              requestId: randomUUID(),
            })
          ).status,
          403,
        );
        assert.equal((await actorCall('/helpdesk/settings', 'PUT', { routing: [] })).status, 403);
        assert.equal(
          (
            await actorCall('/helpdesk/members', 'POST', {
              email: admin.email,
              role: 'admin',
              queues: [],
              active: true,
              canApprove: true,
            })
          ).status,
          403,
        );
      }
      assert.equal((await agentCall('/settings/ai')).status, 403);
      assert.equal(
        (await userCall('/helpdesk/requests', 'POST', { ...create('it'), requesterId: admin.id }))
          .status,
        400,
      );
      assert.equal(
        (await userCall('/helpdesk/requests', 'POST', create('it', hidden.body.requestId))).status,
        409,
      );
      const audit = await adminCall('/helpdesk/audit');
      assert.equal(audit.status, 200);
      assert.ok(audit.body.some((entry) => entry.actorId === agent.id && entry.role === 'agent'));
      assert.ok(audit.body.some((entry) => entry.membershipChange?.targetUserId === agent.id));
      assert.equal(
        (
          await adminCall(`/helpdesk/members/${agent.id}`, 'PUT', {
            role: 'user',
            queues: [],
            active: true,
            canApprove: false,
            version: 2,
          })
        ).status,
        200,
      );
      assert.equal((await agentCall(`/helpdesk/requests/${ownId}`)).status, 404);
      assert.equal((await agentCall('/helpdesk/access')).body.role, 'user');
      await chats.process(pending.shift());
      assert.equal(modelCalls, 2);
      const failedDraft = await chats.get({ id: agent.id, workspaceId: workspace }, queuedDraft.id);
      assert.equal(failedDraft.status, 'failed');
      assert.ok(
        (await adminCall('/helpdesk/audit')).body.some(
          (entry) =>
            entry.actorId === agent.id &&
            entry.method === 'JOB' &&
            entry.outcome === 'denied-or-failed',
        ),
      );

      assert.equal(
        (
          await adminCall(`/helpdesk/members/${agent.id}`, 'PUT', {
            role: 'user',
            queues: [],
            active: false,
            canApprove: false,
            version: 3,
          })
        ).status,
        200,
      );
      assert.equal((await agentCall('/helpdesk/requests')).status, 403);
      assert.equal(
        (
          await adminCall('/helpdesk/members', 'POST', {
            email: admin.email,
            role: 'user',
            queues: [],
            active: true,
            canApprove: false,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await call(null, '/auth/register', 'POST', {
            email: 'forged@roles.test',
            password: 'Fictional-password-123',
            role: 'admin',
          })
        ).status,
        400,
      );
      assert.equal(
        (await call(employee, '/helpdesk/access', 'GET', undefined, '000000000000000000000000'))
          .status,
        403,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.close();
      await store.close();
      await cleanup.db(database).dropDatabase();
      await cleanup.close();
    }
  },
);
