import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { createIntegrationStore } from '../src/integrationStore.js';
import { createHelpdeskService } from '../src/helpdesk.js';
import { createApi } from '../src/app.js';
import { createHelpdeskWorkflows, matchHelpdeskWorkflow } from '../src/helpdeskWorkflows.js';

const uri = process.env.TEST_MONGODB_URI;
test(
  'help desk isolates requests, preserves approvals and never executes proposed actions',
  { skip: !uri },
  async () => {
    process.env.MONGODB_URI = uri;
    const database = `agentzuno_helpdesk_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_DATABASE = database;
    const store = createIntegrationStore();
    const cleanup = new MongoClient(uri);
    const user = { id: 'owner', workspaceId: 'workspace', role: 'admin', canApprove: true };
    const other = { id: 'other', workspaceId: 'other-workspace', role: 'admin' };
    const drafts = [];
    const service = createHelpdeskService(store, {
      create: async (actor, input) => {
        drafts.push({ actor, input });
        return { status: 'queued' };
      },
    });
    let app;
    let server;
    try {
      await store.ready();
      await store
        .collection('helpdeskQueues')
        .insertOne({ ownerId: user.id, workspaceId: user.workspaceId, name: 'IT support' });
      const settings = await service.saveSettings(user, {
        routing: [{ department: 'it', queueName: 'IT support' }],
      });
      assert.ok(settings.channels.every((channel) => !channel.canReceive && !channel.canSend));
      assert.deepEqual((await service.settings(other)).routing, []);
      await assert.rejects(
        service.saveSettings(user, {
          routing: [
            { department: 'it', queueName: 'A' },
            { department: 'it', queueName: 'B' },
          ],
        }),
        { status: 400 },
      );
      const workflowService = createHelpdeskWorkflows(store, {
        create: async () => ({ id: 'workflow-chat', status: 'queued' }),
        send: async () => ({ status: 'queued' }),
      });
      const workflowInput = {
        name: 'Access triage',
        department: 'it',
        keywords: ['access'],
        action: 'handoff',
        queueName: 'Access team',
        enabled: false,
      };
      await store
        .collection('helpdeskQueues')
        .insertOne({ ownerId: user.id, workspaceId: user.workspaceId, name: 'Access team' });
      const workflow = await workflowService.save(user, null, workflowInput);
      assert.equal(await matchHelpdeskWorkflow(store, user, 'it', 'Need access'), null);
      await workflowService.save(user, workflow.id, {
        ...workflowInput,
        definition: workflow.definition,
        enabled: true,
        version: 1,
      });
      assert.equal(
        (await matchHelpdeskWorkflow(store, user, 'it', 'Need ACCESS')).status,
        'escalated',
      );
      assert.equal(await matchHelpdeskWorkflow(store, other, 'it', 'Need access'), null);
      assert.equal(await matchHelpdeskWorkflow(store, user, 'hr', 'Need access'), null);
      await assert.rejects(
        workflowService.save(other, workflow.id, {
          ...workflowInput,
          definition: workflow.definition,
          version: 2,
        }),
        { status: 404 },
      );
      await assert.rejects(
        workflowService.save(user, workflow.id, {
          ...workflowInput,
          definition: workflow.definition,
          version: 1,
        }),
        { status: 409 },
      );
      await assert.rejects(
        workflowService.save(user, null, { ...workflowInput, action: 'grant-access' }),
        { status: 400 },
      );
      await workflowService.conversation(user, {
        text: 'Route VPN requests to IT',
        requestId: randomUUID(),
      });
      await assert.rejects(
        workflowService.followup(other, 'workflow-chat', { text: 'Change it' }),
        { status: 404 },
      );
      assert.equal(
        (await workflowService.followup(user, 'workflow-chat', { text: 'Ask for human review' }))
          .status,
        'queued',
      );
      await workflowService.save(user, workflow.id, {
        ...workflowInput,
        definition: workflow.definition,
        version: 2,
      });
      const input = {
        requestId: randomUUID(),
        title: 'Need software access',
        text: 'Please enable access.',
        department: 'it',
      };
      const created = await service.create(user, input);
      assert.equal(created.queueName, 'IT support');
      assert.equal((await service.create(user, input)).id, created.id);
      await assert.rejects(service.create(user, { ...input, channel: 'slack' }), { status: 400 });
      await assert.rejects(service.create(user, { ...input, ownerId: other.id }), { status: 400 });
      for (const stranger of [other, { ...user, workspaceId: 'other-workspace' }]) {
        await assert.rejects(service.get(stranger, created.id), { status: 404 });
        await assert.rejects(
          service.update(stranger, created.id, { version: 1, status: 'resolved' }),
          { status: 404 },
        );
        await assert.rejects(service.draft(stranger, created.id, { requestId: randomUUID() }), {
          status: 404,
        });
      }
      await assert.rejects(service.update(user, created.id, null), { status: 400 });
      const approval = await service.update(
        user,
        created.id,
        { version: 1, action: 'access-request', reason: 'Manager review required.' },
        'approval',
      );
      assert.equal(approval.status, 'waiting-for-approval');
      await assert.rejects(service.update(user, created.id, { version: 2, status: 'resolved' }), {
        status: 409,
      });
      const decided = await service.update(
        user,
        created.id,
        {
          version: 2,
          approvalId: approval.approvals[0].id,
          decision: 'rejected',
          comment: 'Access is not needed',
        },
        'decision',
      );
      assert.equal(decided.approvals[0].executionStatus, 'not-executed');
      assert.equal(decided.approvals[0].decidedBy, user.id);
      assert.equal(decided.approvals[0].comment, 'Access is not needed');
      assert.equal(decided.approvals[0].status, 'rejected');
      await assert.rejects(service.update(user, created.id, { version: 2, status: 'resolved' }), {
        status: 409,
      });
      const results = await Promise.allSettled([
        service.update(user, created.id, { version: 3, status: 'escalated' }),
        service.update(user, created.id, { version: 3, status: 'resolved' }),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      await service.update(user, created.id, { version: 4, status: 'open' });
      assert.equal(
        (await service.draft(user, created.id, { requestId: randomUUID() })).status,
        'queued',
      );
      assert.equal(drafts.length, 1);
      assert.ok(drafts[0].input.text.includes('Please enable access.'));
      assert.equal(
        JSON.stringify(service.safeRequest(await service.get(user, created.id))).includes(
          'ownerId',
        ),
        false,
      );
      app = createApi();
      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      const base = `http://127.0.0.1:${server.address().port}`;
      assert.equal((await fetch(`${base}/api/helpdesk/requests`)).status, 401);
      assert.equal(
        (
          await fetch(`${base}/api/helpdesk/requests`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: 'https://untrusted.example' },
            body: JSON.stringify(input),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(`${base}/api/helpdesk/requests`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
          })
        ).status,
        401,
      );
      const registration = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'helpdesk@fixture.test',
          password: 'Fictional-password-123!',
        }),
      });
      assert.equal(registration.status, 201);
      const headers = {
        'content-type': 'application/json',
        cookie: registration.headers.get('set-cookie').split(';')[0],
      };
      const savedResponse = await fetch(`${base}/api/helpdesk/requests`, {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      });
      assert.equal(savedResponse.status, 201);
      const saved = await savedResponse.json();
      assert.equal(
        (await fetch(`${base}/api/helpdesk/requests/${created.id}`, { headers })).status,
        404,
      );
      assert.equal(
        (await (await fetch(`${base}/api/helpdesk/requests`, { headers })).json()).length,
        1,
      );
      assert.equal(
        (
          await fetch(`${base}/api/helpdesk/requests/${saved.id}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ version: 1, status: 'escalated' }),
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${base}/api/helpdesk/settings`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ routing: [] }),
          })
        ).status,
        200,
      );
      const auditResponse = await fetch(`${base}/api/helpdesk/audit`, { headers });
      assert.equal(auditResponse.status, 200);
      const audits = await auditResponse.json();
      assert.ok(
        audits.some((record) => record.method === 'PATCH' && record.outcome === 'completed'),
      );
      assert.ok(audits.some((record) => record.statusCode === 404));
      assert.equal(JSON.stringify(audits).includes(input.text), false);
      assert.equal(JSON.stringify(audits).includes('Fictional-password'), false);
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      if (app) await app.locals.close();
      await store.close();
      await cleanup.db(database).dropDatabase();
      await cleanup.close();
    }
  },
);
