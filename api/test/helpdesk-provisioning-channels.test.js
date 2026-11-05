import { encryptSecret } from '../src/secrets.js';
import { toTypeScript } from '../sdk/workflows/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId, MongoClient } from 'mongodb';
import { randomBytes, randomUUID } from 'node:crypto';
import { createIntegrationStore } from '../src/integrationStore.js';
import { createHelpdeskChannels } from '../src/helpdeskChannels.js';
import { createProvisioningService, provisionIdentityUser } from '../src/helpdeskProvisioning.js';
import { createHelpdeskWorkflows } from '../src/helpdeskWorkflows.js';
import { createApi } from '../src/app.js';
const uri = process.env.TEST_MONGODB_URI;
test(
  'channel authorization is owner/workspace/browser bound, single use, encrypted and fail closed',
  { skip: !uri },
  async () => {
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_DATABASE = `agentzuno_channels_${randomUUID().replaceAll('-', '')}`;
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const store = createIntegrationStore();
    const cleanup = new MongoClient(uri);
    const user = {
      id: new ObjectId().toHexString(),
      workspaceId: new ObjectId().toHexString(),
      role: 'admin',
    };
    user.helpdeskOwnerId = user.id;
    const requests = [];
    const service = createHelpdeskChannels(store, async (url, options) => {
      requests.push({ url, options });
      assert.equal(options.redirect, 'error');
      return new Response(
        JSON.stringify(
          url.endsWith('oauth.v2.access')
            ? {
                ok: true,
                access_token: 'fixture-channel-token',
                token_type: 'bot',
                bot_user_id: 'U123BOT',
                app_id: 'A123APP',
                team: { id: 'T123TEAM', name: 'Fixture Team' },
                scope:
                  'app_mentions:read,chat:write,channels:history,groups:history,channels:read,groups:read,im:history,im:read',
              }
            : { ok: true, team_id: 'T123TEAM' },
        ),
      );
    });
    try {
      await store.ready();
      await store.collection('users').insertOne({ ...user, email: 'admin@channels.test' });
      await store.collection('helpdeskChannelApplications').insertOne({
        ownerId: user.id,
        workspaceId: user.workspaceId,
        provider: 'slack',
        clientId: 'fixture-client',
        clientSecret: encryptSecret('fixture-secret'),
        signingSecret: encryptSecret('fixture-signing-secret'),
        version: 1,
      });
      await assert.rejects(service.start({ ...user, role: 'user' }, { provider: 'slack' }), {
        status: 403,
      });
      const start = await service.start(user, { provider: 'slack' });
      const state = new URL(start.url).searchParams.get('state');
      await assert.rejects(
        service.complete(user, { state, code: 'fixture-code' }, '0'.repeat(64)),
        { status: 401 },
      );
      await service.complete(user, { state, code: 'fixture-code' }, start.browser);
      await assert.rejects(service.complete(user, { state, code: 'fixture-code' }, start.browser), {
        status: 401,
      });
      assert.equal(requests.length, 2);
      assert.equal(requests[0].url, 'https://slack.com/api/oauth.v2.access');
      const saved = await store.collection('helpdeskChannels').findOne({ provider: 'slack' });
      assert.ok(!JSON.stringify(saved.credential).includes('fixture-channel-token'));
      const listed = await service.list(user);
      assert.deepEqual(
        listed.map((value) => value.id),
        ['gmail', 'teams', 'outlook', 'slack'],
      );
      assert.ok(!JSON.stringify(listed).includes('fixture-channel-token'));
      assert.ok(listed.every((value) => !value.canReceive && !value.canSend));
      const second = await service.start(user, { provider: 'slack' });
      await assert.rejects(
        service.complete(
          { ...user, id: 'other' },
          { state: new URL(second.url).searchParams.get('state'), code: 'fixture' },
          second.browser,
        ),
        { status: 401 },
      );
      const failed = createHelpdeskChannels(
        store,
        async () => new Response(JSON.stringify({ ok: false, access_token: 'secret' })),
      );
      const third = await failed.start(user, { provider: 'slack' });
      await assert.rejects(
        failed.complete(
          user,
          { state: new URL(third.url).searchParams.get('state'), code: 'fixture' },
          third.browser,
        ),
        { status: 422 },
      );
      const revoked = await service.start(user, { provider: 'slack' });
      await store.collection('users').deleteOne({ id: user.id });
      await assert.rejects(
        service.complete(
          user,
          { state: new URL(revoked.url).searchParams.get('state'), code: 'fixture' },
          revoked.browser,
        ),
        { status: 403 },
      );
    } finally {
      await store.close();
      await cleanup.db(process.env.MONGODB_DATABASE).dropDatabase();
      await cleanup.close();
    }
  },
);
test(
  'identity provisioning creates User-only principals, preserves subject binding and applies SCIM deactivation',
  { skip: !uri },
  async () => {
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_DATABASE = `agentzuno_provisioning_${randomUUID().replaceAll('-', '')}`;
    const store = createIntegrationStore();
    const cleanup = new MongoClient(uri);
    const settings = {
      ownerId: new ObjectId().toHexString(),
      workspaceId: new ObjectId().toHexString(),
      issuer: 'https://fixture.okta.com',
      enabled: true,
      autoProvision: true,
    };
    const service = createProvisioningService(store);
    const claims = {
      iss: settings.issuer,
      sub: 'employee-1',
      email: 'employee@org.test',
      email_verified: true,
      name: 'Fixture employee',
    };
    try {
      await store.ready();
      await store.collection('users').insertOne({
        id: settings.ownerId,
        workspaceId: settings.workspaceId,
        email: 'owner@org.test',
      });
      const directory = await service.apply(settings, null, {
        userName: claims.email,
        externalId: claims.sub,
        displayName: claims.name,
        active: true,
      });
      const user = await provisionIdentityUser(store, settings, claims);
      assert.equal(user.identityOnly, true);
      const member = await store
        .collection('helpdeskMembers')
        .findOne({ workspaceId: settings.workspaceId, userId: user.id });
      assert.equal(member.role, 'user');
      assert.deepEqual(member.queues, []);
      assert.equal(member.canApprove, false);
      assert.equal((await provisionIdentityUser(store, settings, claims)).id, user.id);
      await assert.rejects(
        provisionIdentityUser(store, settings, { ...claims, sub: 'different-subject' }),
        { status: 403 },
      );
      await assert.rejects(
        service.apply(settings, null, { userName: 'elevate@org.test', role: 'admin' }),
        { status: 400 },
      );
      await service.apply(settings, directory.id, { active: false });
      assert.equal(
        (
          await store
            .collection('helpdeskMembers')
            .findOne({ workspaceId: settings.workspaceId, userId: user.id })
        ).active,
        false,
      );
      await assert.rejects(provisionIdentityUser(store, settings, claims), { status: 403 });
      await assert.rejects(
        provisionIdentityUser(store, { ...settings, autoProvision: false }, claims),
        { status: 403 },
      );
      await assert.rejects(
        service.apply({ ...settings, workspaceId: new ObjectId().toHexString() }, directory.id, {
          active: true,
        }),
        { status: 404 },
      );
      // A local account with the same verified email is never automatically linked.
      await store.collection('users').insertOne({
        id: 'local-user',
        workspaceId: new ObjectId().toHexString(),
        email: 'local@org.test',
      });
      const enterprise = await provisionIdentityUser(store, settings, {
        ...claims,
        sub: 'new-subject',
        email: 'local@org.test',
      });
      assert.notEqual(enterprise.id, 'local-user');
      const workflowService = createHelpdeskWorkflows(store, {});
      const owner = {
        id: settings.ownerId,
        workspaceId: settings.workspaceId,
        helpdeskOwnerId: settings.ownerId,
        role: 'admin',
      };
      const definition = {
        version: 1,
        name: 'Desk help',
        trigger: { department: 'it', phrases: ['desk help'] },
        steps: [
          {
            id: 'open-incident',
            action: 'servicenow.createIncident',
            params: { assignmentGroup: 'Desktop support', shortDescription: 'Desk help' },
          },
        ],
      };
      const input = {
        name: definition.name,
        department: 'it',
        keywords: ['desk help'],
        action: 'handoff',
        queueName: 'it',
        enabled: false,
        definition,
      };
      const draft = await workflowService.save(owner, null, input);
      assert.equal(draft.definition.steps[0].action, 'servicenow.createIncident');
      await assert.rejects(
        workflowService.save(owner, draft.id, { ...input, enabled: true, version: 1 }),
        { status: 422 },
      );
      await assert.rejects(
        workflowService.save(owner, draft.id, {
          name: input.name,
          department: 'it',
          keywords: input.keywords,
          action: 'handoff',
          queueName: 'it',
          enabled: true,
          version: 1,
        }),
        { status: 400 },
      );
    } finally {
      await store.close();
      await cleanup.db(process.env.MONGODB_DATABASE).dropDatabase();
      await cleanup.close();
    }
  },
);
test(
  'SCIM endpoints reject unbound tokens and support authenticated provisioning without granting roles',
  { skip: !uri },
  async () => {
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_DATABASE = `agentzuno_scim_${randomUUID().replaceAll('-', '')}`;
    const app = createApi();
    const store = createIntegrationStore();
    const cleanup = new MongoClient(uri);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const registered = await fetch(`${base}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'scim-owner@fixture.test',
          password: 'Fictional-SCIM-password!',
        }),
      });
      const cookie = registered.headers.get('set-cookie').split(';')[0];
      const user = (await registered.json()).user;
      const now = new Date();
      await store.collection('identitySettings').insertOne({
        ownerId: user.id,
        workspaceId: user.workspaceId,
        issuer: 'https://fixture.okta.com',
        enabled: true,
        autoProvision: true,
        updatedAt: now,
      });
      const issued = await fetch(`${base}/api/helpdesk/provisioning/token`, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(issued.status, 200);
      const { token } = await issued.json();
      const path = `${base}/api/provisioning/${user.workspaceId}/scim/v2/Users`;
      assert.equal((await fetch(path)).status, 401);
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/scim+json' };
      const created = await fetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify({ userName: 'employee@fixture.test', externalId: 'fixture-subject' }),
      });
      assert.equal(created.status, 201);
      const directory = await created.json();
      assert.equal((await (await fetch(path, { headers })).json()).totalResults, 1);
      assert.equal(
        (
          await fetch(`${path}/${directory.id}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ Operations: [{ op: 'replace', path: 'active', value: false }] }),
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await fetch(`${path}/${directory.id}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ Operations: [{ op: 'replace', path: 'role', value: 'admin' }] }),
          })
        ).status,
        400,
      );
      await store
        .collection('identitySettings')
        .updateOne({ workspaceId: user.workspaceId }, { $set: { enabled: false } });
      assert.equal((await fetch(path, { headers })).status, 401);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.close();
      await store.close();
      await cleanup.db(process.env.MONGODB_DATABASE).dropDatabase();
      await cleanup.close();
    }
  },
);

test(
  'workflow conversation revisions update the validated graph and TypeScript while retaining the last valid draft',
  { skip: !uri },
  async () => {
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_DATABASE = `agentzuno_workflow_graph_${randomUUID().replaceAll('-', '')}`;
    const store = createIntegrationStore();
    const cleanup = new MongoClient(uri);
    const user = { id: 'admin', workspaceId: 'workspace', role: 'admin' };
    const definition = {
      version: 1,
      name: 'Phone setup',
      trigger: { department: 'it', phrases: ['office phone'] },
      steps: [
        {
          id: 'notify-support',
          action: 'slack.postMessage',
          params: { channel: 'support-desk', text: 'Phone setup help requested' },
        },
      ],
    };
    let response = {
      status: 'complete',
      messages: [
        {
          role: 'assistant',
          status: 'complete',
          text: 'Review the workflow.',
          proposals: {
            workflow: { kind: 'workflow', source: toTypeScript(definition), definition },
          },
        },
      ],
      updatedAt: new Date(),
    };
    const service = createHelpdeskWorkflows(store, {
      create: async () => ({ id: 'fixture-conversation', status: 'queued' }),
      get: async () => response,
      send: async () => ({ status: 'queued' }),
    });
    try {
      await store.ready();
      await service.conversation(user, {
        text: 'Notify support for office phone requests',
        requestId: randomUUID(),
      });
      const initial = await service.getConversation(user, 'fixture-conversation');
      assert.equal(initial.definition.steps.length, 1);
      assert.ok(initial.typescript.includes('defineWorkflow'));
      response = {
        ...response,
        messages: [
          {
            role: 'assistant',
            status: 'complete',
            text: 'Review the updated workflow.',
            proposals: {
              workflow: {
                kind: 'workflow',
                source: toTypeScript({
                  ...definition,
                  steps: [
                    ...definition.steps,
                    {
                      id: 'open-jira',
                      action: 'jira.createIssue',
                      params: { project: 'DESKTOP', issueType: 'Task', summary: 'Phone help' },
                    },
                  ],
                }),
              },
            },
          },
        ],
      };
      const updated = await service.getConversation(user, 'fixture-conversation');
      assert.equal(updated.definition.steps.length, 2);
      assert.ok(updated.typescript.includes('jira.createIssue'));
      response = {
        ...response,
        messages: [
          {
            role: 'assistant',
            status: 'complete',
            text: 'Review this draft.',
            proposals: { workflow: { kind: 'workflow', source: 'export default {};' } },
          },
        ],
      };
      const rejected = await service.getConversation(user, 'fixture-conversation');
      assert.ok(rejected.validationError);
      assert.equal(rejected.definition.steps.length, 2);
      await assert.rejects(
        service.getConversation({ ...user, role: 'user' }, 'fixture-conversation'),
        { status: 403 },
      );
      await assert.rejects(
        service.getConversation({ ...user, id: 'other-admin' }, 'fixture-conversation'),
        { status: 404 },
      );
    } finally {
      await store.close();
      await cleanup.db(process.env.MONGODB_DATABASE).dropDatabase();
      await cleanup.close();
    }
  },
);

test(
  'new Gmail authorizations activate resolution intake and replies without exposing provider credentials',
  { skip: !uri },
  async () => {
    process.env.MONGODB_URI = uri;
    const database = `agentzuno_gmail_oauth_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_DATABASE = database;
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const store = createIntegrationStore();
    const cleanup = new MongoClient(uri);
    const user = {
      id: new ObjectId().toHexString(),
      workspaceId: new ObjectId().toHexString(),
      role: 'admin',
    };
    user.helpdeskOwnerId = user.id;
    const service = createHelpdeskChannels(store, async (url) =>
      url.includes('/token')
        ? Response.json({
            access_token: 'fixture-gmail-access',
            refresh_token: 'fixture-gmail-refresh',
            expires_in: 3600,
            scope:
              'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
          })
        : Response.json({ emailAddress: 'support@fixture.test' }),
    );
    try {
      await store.ready();
      await store.collection('users').insertOne({ ...user, email: 'admin@fixture.test' });
      await store.collection('helpdeskChannelApplications').insertOne({
        ownerId: user.id,
        workspaceId: user.workspaceId,
        provider: 'gmail',
        clientId: 'fixture-google-client',
        clientSecret: encryptSecret('fixture-google-secret'),
        version: 1,
      });
      const start = await service.start(user, { provider: 'gmail' });
      const state = new URL(start.url).searchParams.get('state');
      await service.complete(user, { state, code: 'fixture-code' }, start.browser);
      const channel = (await service.list(user)).find((item) => item.id === 'gmail');
      assert.equal(channel.email.enabled, true);
      assert.equal(channel.email.autoReply, true);
      assert.equal(channel.canReceive, true);
      assert.equal(channel.canSend, true);
      assert.ok(!JSON.stringify(channel).includes('fixture-gmail-access'));
    } finally {
      await store.close();
      await cleanup.db(database).dropDatabase();
      await cleanup.close();
    }
  },
);
