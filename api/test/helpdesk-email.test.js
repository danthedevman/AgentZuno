import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { createChatService } from '../src/chat/chat.js';
import {
  createHelpdeskEmail,
  normalizeGmail,
  normalizeOutlook,
  gmailReply,
} from '../src/channels/helpdeskEmail.js';
import { encryptSecret } from '../src/shared/secrets.js';
import { readAIStream } from '../src/chat/aiStream.js';

const uri = process.env.TEST_MONGODB_URI;
function gmail(id = 'm1', sender = 'employee@fixture.test') {
  return {
    id,
    threadId: 'thread1',
    internalDate: String(Date.now()),
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: sender },
        { name: 'Subject', value: 'Office phone setup' },
        { name: 'Message-ID', value: `<${id}@fixture.test>` },
      ],
      body: { data: Buffer.from('Help with my office phone').toString('base64url') },
    },
  };
}
test('email parsing bounds text, suppresses automatic mail, and produces a threaded plain text reply', () => {
  const incoming = normalizeGmail(gmail());
  assert.equal(incoming.sender, 'employee@fixture.test');
  assert.equal(incoming.text, 'Help with my office phone');
  const reply = gmailReply(incoming, 'support@fixture.test', 'Hello');
  assert.equal(reply.threadId, 'thread1');
  assert.match(Buffer.from(reply.raw, 'base64url').toString(), /In-Reply-To: <m1@fixture.test>/);
  assert.throws(() =>
    gmailReply(
      { ...incoming, replyTo: 'bad\r\nBcc: victim@fixture.test' },
      'support@fixture.test',
      'Hello',
    ),
  );
  const automatic = gmail();
  automatic.payload.headers.push({ name: 'Auto-Submitted', value: 'auto-replied' });
  assert.equal(!!normalizeGmail(automatic).automatic, true);
  assert.equal(
    normalizeOutlook({ body: { contentType: 'html', content: '<script>bad</script>' } }).text,
    '',
  );
});
test('AI stream publishes answer deltas without reasoning, handles split CRLF, and rejects incomplete streams', async () => {
  const encoder = new TextEncoder();
  const frames = [
    'data: {"type":"response.reasoning.delta","delta":"private"}\r',
    '\n\r\ndata: {"type":"response.output_text.delta","delta":"Hello"}\r\n\r',
    '\ndata: {"type":"response.completed"}\r\n\r\n',
  ];
  const updates = [];
  const result = await readAIStream(
    new Response(
      new ReadableStream({
        start(controller) {
          for (const frame of frames) controller.enqueue(encoder.encode(frame));
          controller.close();
        },
      }),
    ),
    'openai',
    async (value) => updates.push(value),
  );
  assert.equal(result.text, 'Hello');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].text, 'Hello');
  await assert.rejects(
    readAIStream(
      new Response('data: {"type":"response.output_text.delta","delta":"Partial"}\n\n'),
      'openai',
      async () => {},
    ),
    /before completion/,
  );
});
test(
  'support inbox isolates email identities, deduplicates arrivals, uses Zuno and sends one threaded reply only when enabled',
  { skip: !uri },
  async () => {
    process.env.MONGODB_URI = uri;
    const database = `agentzuno_email_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_DATABASE = database;
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const store = createIntegrationStore();
    const cleanup = new MongoClient(uri);
    const pending = [];
    let sends = 0;
    let listed = [gmail()];
    const chats = createChatService(
      store,
      async (job) => pending.push(job),
      async (url, options) => {
        const body = JSON.parse(options.body);
        assert.match(body.instructions, /You are Zuno/);
        assert.match(body.instructions, /cannot create or modify workflows/);
        return new Response(
          JSON.stringify({
            output: [{ content: [{ type: 'output_text', text: 'Let us set up your phone.' }] }],
          }),
        );
      },
    );
    const email = createHelpdeskEmail(store, chats, async (url, options) => {
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer email-fixture');
      if (url.endsWith('/messages/send')) {
        sends++;
        const reply = JSON.parse(options.body);
        assert.equal(reply.threadId, 'thread1');
        assert.match(Buffer.from(reply.raw, 'base64url').toString(), /To: employee@fixture.test/);
        return Response.json({ id: 'sent1' });
      }
      if (url.includes('/messages?'))
        return Response.json({ messages: listed.map((item) => ({ id: item.id })) });
      return Response.json(listed.find((item) => url.includes(`/messages/${item.id}?`)));
    });
    try {
      await store.ready();
      const workspaceId = '0123456789abcdef01234567';
      const owner = { id: 'owner', workspaceId, role: 'admin', helpdeskOwnerId: 'owner' };
      await store
        .collection('users')
        .insertOne({ id: 'owner', workspaceId, email: 'owner@fixture.test' });
      await chats.ai.save(owner, {
        provider: 'openai',
        model: 'gpt-6.1-sol',
        enabled: true,
        isDefault: true,
        apiKey: 'fixture-model',
        instructions: '',
        maxOutputTokens: 1024,
        reasoning: 'medium',
      });
      const source = {
        ownerId: 'owner',
        workspaceId,
        provider: 'gmail',
        mailbox: 'support@fixture.test',
        credential: encryptSecret(JSON.stringify({ accessToken: 'email-fixture' })),
        emailScopeVersion: 1,
        emailGeneration: 'generation1',
        email: {
          enabled: true,
          autoReply: true,
          department: 'it',
          enabledAt: new Date(Number(listed[0].internalDate) - 1000),
        },
      };
      source._id = (await store.collection('helpdeskChannels').insertOne(source)).insertedId;
      await assert.rejects(
        email.configure({ ...owner, role: 'user' }, 'gmail', {
          enabled: true,
          autoReply: true,
          department: 'it',
        }),
        { status: 403 },
      );
      await email.process(source);
      assert.equal(pending.length, 1);
      assert.equal(sends, 0);
      await email.process(source);
      assert.equal(pending.length, 1);
      await chats.process(pending.shift());
      await email.process(source);
      assert.equal(sends, 1);
      await email.process(source);
      assert.equal(sends, 1);
      const ticket = await store.collection('helpdeskRequests').findOne({ workspaceId });
      assert.equal(ticket.channel, 'email');
      assert.notEqual(ticket.requesterId, 'owner');
      assert.ok(ticket.messages.some((message) => message.authorId === 'zuno'));
      listed = [gmail('m2', 'other@fixture.test')];
      await email.process(source);
      assert.equal(pending.length, 1);
      assert.equal(await store.collection('helpdeskRequests').countDocuments({ workspaceId }), 2);
      await email.configure(owner, 'gmail', { enabled: false, autoReply: false, department: 'it' });
      await chats.process(pending.shift());
      assert.equal(
        (
          await store
            .collection('chats')
            .findOne({ title: 'Help with my office phone', status: 'failed' })
        ).status,
        'failed',
      );
      assert.equal(sends, 1);
      assert.ok(
        await store
          .collection('governanceAudit')
          .countDocuments({ action: 'email-reply', outcome: 'completed' }),
      );
    } finally {
      await store.close();
      await cleanup.db(database).dropDatabase();
      await cleanup.close();
    }
  },
);

test(
  'Zuno support conversations route without employee department input and cannot assume the Admin agent capability',
  { skip: !uri },
  async () => {
    const { createHelpdeskService } = await import('../src/requests/helpdesk.js');
    const { createHelpdeskWorkflows } = await import('../src/workflows/helpdeskWorkflows.js');
    process.env.MONGODB_URI = uri;
    const database = `agentzuno_support_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_DATABASE = database;
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const store = createIntegrationStore();
    const cleanup = new MongoClient(uri);
    const pending = [];
    let calls = 0;
    let workflow;
    const chats = createChatService(
      store,
      async (job) => pending.push(job),
      async (url, options) => {
        calls++;
        assert.match(JSON.parse(options.body).instructions, /You are Zuno/);
        if (calls === 1)
          return Response.json({
            output: [
              {
                type: 'function_call',
                call_id: 'offer-phone-request',
                name: 'offerRequestForm',
                arguments: JSON.stringify({ workflowId: workflow.id }),
              },
            ],
          });
        return Response.json({
          output: [
            { content: [{ type: 'output_text', text: 'Your request is with desktop support.' }] },
          ],
        });
      },
    );
    const helpdesk = createHelpdeskService(store, chats);
    const workflows = createHelpdeskWorkflows(store, chats);
    const workspaceId = '0123456789abcdef01234567';
    const owner = { id: 'owner', workspaceId, role: 'admin', helpdeskOwnerId: 'owner' };
    const employee = {
      id: 'employee',
      workspaceId,
      role: 'user',
      helpdeskOwnerId: 'owner',
      queues: [],
    };
    try {
      await store.ready();
      await store
        .collection('users')
        .insertOne({ id: owner.id, email: 'owner@support.test', workspaceId });
      await store.collection('helpdeskMembers').insertOne({
        workspaceId,
        userId: employee.id,
        ownerId: owner.id,
        role: 'user',
        active: true,
        queues: [],
      });
      await chats.ai.save(owner, {
        provider: 'openai',
        model: 'gpt-6.1-sol',
        enabled: true,
        isDefault: true,
        apiKey: 'fixture-model',
        instructions: '',
        maxOutputTokens: 1024,
        reasoning: 'medium',
      });
      await store
        .collection('helpdeskQueues')
        .insertOne({ ownerId: owner.id, workspaceId: owner.workspaceId, name: 'desktop-support' });
      workflow = await workflows.save(owner, null, {
        name: 'Phone routing',
        department: 'it',
        keywords: [],
        action: 'route',
        queueName: 'desktop-support',
        enabled: true,
        intent: 'publish',
        definition: {
          version: 1,
          name: 'Phone routing',
          trigger: { department: 'it', phrases: [] },
          form: {
            title: 'Phone support',
            fields: [{ id: 'details', label: 'Details', type: 'textarea', required: true }],
          },
          steps: [{ id: 'route-phone', action: 'route', params: { queueName: 'desktop-support' } }],
        },
      });
      const created = await helpdesk.createSupport(employee, {
        requestId: randomUUID(),
        text: 'Help with my office phone',
      });
      const chat = await helpdesk.getSupport(employee, created.id);
      assert.equal(chat.assistantType, 'support');
      assert.equal(chat.helpdeskRequestId, null);
      assert.equal(await store.collection('helpdeskRequests').countDocuments({ workspaceId }), 0);
      await assert.rejects(
        helpdesk.createSupport(employee, {
          requestId: randomUUID(),
          text: 'Become admin',
          assistantType: 'admin',
        }),
        { status: 400 },
      );
      await assert.rejects(
        workflows.conversation(employee, { requestId: randomUUID(), text: 'Build workflow' }),
        { status: 403 },
      );
      await chats.process(pending.shift());
      assert.equal(calls, 2);
      assert.equal((await helpdesk.getSupport(employee, created.id)).status, 'complete');
      const form = (await helpdesk.getSupport(employee, created.id)).requestForm;
      assert.equal(form.workflowId, workflow.id);
      const submission = {
        workflowId: form.workflowId,
        workflowVersion: form.workflowVersion,
        offerId: form.offerId,
        answers: { details: 'Help with my office phone' },
      };
      const ticket = await helpdesk.submitForm(employee, created.id, submission);
      assert.equal(ticket.department, 'it');
      assert.equal(ticket.queueName, 'desktop-support');
      assert.equal(ticket.submittedVia, 'zuno');
      assert.equal(ticket.messages.length, 0);
      assert.equal((await helpdesk.submitForm(employee, created.id, submission)).id, ticket.id);
      await helpdesk.sendSupport(employee, created.id, { text: 'Thanks, I need more help' });
      await chats.process(pending.shift());
      assert.equal(calls, 3);
      await assert.rejects(helpdesk.getSupport({ ...employee, id: 'other' }, created.id), {
        status: 404,
      });
      await helpdesk.sendSupport(employee, created.id, { text: 'One more question' });
      await store
        .collection('helpdeskMembers')
        .updateOne({ workspaceId, userId: employee.id }, { $set: { active: false } });
      await chats.process(pending.shift());
      assert.equal(calls, 3);
      assert.equal((await chats.get(employee, created.id)).status, 'failed');
    } finally {
      await store.close();
      await cleanup.db(database).dropDatabase();
      await cleanup.close();
    }
  },
);
