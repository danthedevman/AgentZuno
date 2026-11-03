import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import {
  defineWorkflow,
  validateFormAnswers,
  resolveWorkflowRouting,
  runWorkflow,
} from '../sdk/workflows/index.js';
import { createIntegrationStore } from '../src/integrationStore.js';
import { createHelpdeskWorkflows } from '../src/helpdeskWorkflows.js';
import { createHelpdeskService } from '../src/helpdesk.js';
import { createChatService } from '../src/chat.js';
const definition = {
  version: 1,
  name: 'Laptop Order',
  trigger: { department: 'it', phrases: ['laptop'] },
  steps: [{ id: 'route-request', action: 'route', params: { queueName: 'Desktop Support' } }],
  routing: [
    {
      id: 'mac-support',
      match: 'all',
      conditions: [{ fieldId: 'platform', operator: 'equals', value: 'Mac' }],
      action: 'handoff',
      queueName: 'Mac Support',
    },
  ],
  form: {
    title: 'Laptop Order',
    fields: [
      {
        id: 'platform',
        label: 'Operating System',
        type: 'select',
        required: true,
        options: ['Mac', 'Windows'],
      },
      { id: 'mouse', label: 'Mouse', type: 'boolean', required: false },
      { id: 'keyboard', label: 'Keyboard', type: 'boolean', required: false },
    ],
  },
};
test('workflow forms validate schema and answers without accepting invented fields or choices', () => {
  assert.deepEqual(defineWorkflow(definition).form, definition.form);
  assert.throws(() =>
    defineWorkflow({
      ...definition,
      form: { ...definition.form, fields: [...definition.form.fields, definition.form.fields[0]] },
    }),
  );
  assert.throws(() => validateFormAnswers(definition.form, {}), /required/);
  assert.throws(() => validateFormAnswers(definition.form, { platform: 'Linux' }), /valid/);
  assert.throws(
    () => validateFormAnswers(definition.form, { platform: 'Mac', admin: true }),
    /Unexpected/,
  );
  assert.throws(
    () => validateFormAnswers(definition.form, { platform: 'Mac', mouse: 'yes' }),
    /Invalid/,
  );
  assert.deepEqual(
    validateFormAnswers(definition.form, { platform: 'Mac', mouse: true }).map(
      (answer) => answer.value,
    ),
    ['Mac', true, false],
  );
});
test(
  'enabled forms are private to each chat, reject stale revisions, and persist request answers only on submission',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const uri = process.env.TEST_MONGODB_URI;
    const database = `agentzuno_forms_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_DATABASE = database;
    const store = createIntegrationStore();
    const cleanup = new MongoClient(uri);
    const admin = { id: 'owner', workspaceId: 'workspace', role: 'admin' };
    const user = {
      id: 'employee',
      helpdeskOwnerId: 'owner',
      workspaceId: 'workspace',
      role: 'user',
    };
    const other = { ...user, id: 'other' };
    const chats = createChatService(store, async () => {});
    const service = createHelpdeskService(store, chats);
    const workflows = createHelpdeskWorkflows(store, chats);
    const input = {
      name: definition.name,
      department: 'it',
      keywords: ['laptop'],
      action: 'route',
      queueName: 'Desktop Support',
      enabled: false,
      definition,
    };
    try {
      await store.ready();
      await store.collection('helpdeskQueues').insertMany(
        ['Desktop Support', 'Mac Support'].map((name) => ({
          ownerId: 'owner',
          workspaceId: 'workspace',
          name,
        })),
      );
      const workflow = await workflows.save(admin, null, input);
      await assert.rejects(workflows.save(user, null, input), { status: 403 });
      const conversation = await service.createSupport(user, {
        requestId: randomUUID(),
        text: 'How can I request a Mac?',
      });
      await store
        .collection('chats')
        .updateOne({ _id: new ObjectId(conversation.id) }, { $set: { status: 'complete' } });
      assert.equal(
        service.safeSupport(await service.getSupport(user, conversation.id)).requestForm,
        null,
      );
      await workflows.save(admin, workflow.id, { ...input, version: 1, enabled: true });
      const offered = service.safeSupport(
        await service.getSupport(user, conversation.id),
      ).requestForm;
      assert.equal(offered.title, 'Laptop Order');
      assert.equal(await store.collection('helpdeskRequests').countDocuments({}), 0);
      await assert.rejects(service.getSupport(other, conversation.id), { status: 404 });
      await assert.rejects(
        service.getSupport({ ...user, workspaceId: 'elsewhere' }, conversation.id),
        { status: 404 },
      );
      const payload = {
        workflowId: workflow.id,
        workflowVersion: 2,
        answers: { platform: 'Mac', mouse: true },
      };
      await assert.rejects(
        service.submitForm(user, conversation.id, { ...payload, answers: { platform: 'Other' } }),
        { status: 400 },
      );
      await workflows.save(admin, workflow.id, { ...input, version: 2, enabled: true });
      await assert.rejects(service.submitForm(user, conversation.id, payload), { status: 409 });
      const ticket = await service.submitForm(user, conversation.id, {
        ...payload,
        workflowVersion: 3,
      });
      assert.equal(ticket.submittedVia, 'zuno');
      assert.equal(ticket.queueName, 'Desktop Support');
      assert.equal(ticket.status, 'open');
      assert.equal(ticket.formSubmission.routing.status, 'pending-execution');
      assert.deepEqual(
        ticket.formSubmission.answers.map((answer) => answer.value),
        ['Mac', true, false],
      );
      assert.equal(
        (await service.submitForm(user, conversation.id, { ...payload, workflowVersion: 3 })).id,
        ticket.id,
      );
      assert.equal(await store.collection('helpdeskRequests').countDocuments({}), 1);
      const confirmed = await service.getSupport(user, conversation.id);
      const receipts = confirmed.messages.filter(
        (message) => message.kind === 'request-confirmation',
      );
      assert.equal(receipts.length, 1);
      assert.equal(receipts[0].formReceipt.requestId, ticket.id);
      assert.equal(receipts[0].formReceipt.answers[0].value, 'Mac');
      assert.match(receipts[0].text, /has been submitted/);
      await assert.rejects(service.get(other, ticket.id), { status: 404 });
      assert.equal(
        service.safeSupport(await service.getSupport(user, conversation.id)).requestForm,
        null,
      );
      // A later turn can submit another form, but replaying its offer stays idempotent.
      const nextResponse = randomUUID();
      await store.collection('chats').updateOne(
        { _id: new ObjectId(conversation.id) },
        {
          $set: { responseId: nextResponse },
          $push: {
            messages: {
              id: randomUUID(),
              role: 'user',
              text: 'I need another one with 32GB',
              status: 'complete',
              createdAt: new Date(),
            },
          },
        },
      );
      const nextForm = service.safeSupport(
        await service.getSupport(user, conversation.id),
      ).requestForm;
      assert.equal(nextForm.offerId, nextResponse);
      const another = await service.submitForm(user, conversation.id, {
        ...payload,
        workflowVersion: 3,
        offerId: nextForm.offerId,
      });
      assert.notEqual(another.id, ticket.id);
      assert.equal(another.chatId, conversation.id);
      assert.equal(
        (
          await service.submitForm(user, conversation.id, {
            ...payload,
            workflowVersion: 3,
            offerId: nextForm.offerId,
          })
        ).id,
        another.id,
      );
      assert.equal((await service.getSupport(user, conversation.id)).requests.length, 2);
      assert.equal((await service.reviewTicket(user, ticket.id)).chatId, conversation.id);
      assert.deepEqual(await service.catalog(user), []);
      const catalogDefinition = { ...definition, displayInCatalog: true };
      await workflows.save(admin, workflow.id, {
        ...input,
        definition: catalogDefinition,
        version: 3,
        enabled: true,
      });
      assert.equal((await service.catalog(user)).length, 1);
      const catalogChat = await service.createSupport(user, {
        requestId: randomUUID(),
        workflowId: workflow.id,
      });
      const catalogForm = service.safeSupport(await service.getSupport(user, catalogChat.id));
      assert.equal(catalogForm.status, 'complete');
      assert.equal(catalogForm.requestForm.workflowId, workflow.id);
      assert.equal(catalogForm.requestForm.workflowVersion, 4);
      await workflows.save(admin, workflow.id, {
        ...input,
        definition: catalogDefinition,
        version: 4,
        enabled: true,
      });
      const refreshedForm = service.safeSupport(await service.getSupport(user, catalogChat.id));
      assert.equal(refreshedForm.requestForm.workflowVersion, 5);
      await assert.rejects(
        service.submitForm(user, catalogChat.id, { ...payload, workflowVersion: 4 }),
        { status: 409 },
      );
      const refreshedRequest = await service.submitForm(user, catalogChat.id, {
        ...payload,
        workflowVersion: 5,
      });
      assert.equal(refreshedRequest.formSubmission.workflowVersion, 5);
      const second = await service.createSupport(user, {
        requestId: randomUUID(),
        text: 'I need another one with 32GB',
      });
      await store
        .collection('chats')
        .updateOne({ _id: new ObjectId(second.id) }, { $set: { status: 'complete' } });
      await workflows.save(admin, workflow.id, { ...input, version: 5, enabled: false });
      assert.equal((await service.getSupport(user, catalogChat.id)).requestForm, null);
      const removedDefinition = {
        ...definition,
        form: {
          ...definition.form,
          fields: definition.form.fields.filter((field) => field.id !== 'mouse'),
        },
      };
      await assert.rejects(
        workflows.save(admin, workflow.id, {
          ...input,
          definition: removedDefinition,
          version: 6,
          enabled: false,
        }),
        { status: 409 },
      );
      const removed = await workflows.save(admin, workflow.id, {
        ...input,
        definition: removedDefinition,
        version: 6,
        enabled: false,
        confirmedRemovedFieldIds: ['mouse'],
      });
      assert.equal(removed.definition.form.fields.length, 2);
      await assert.rejects(
        service.submitForm(user, second.id, { ...payload, workflowVersion: 3 }),
        { status: 409 },
      );
    } finally {
      await store.close();
      await cleanup.db(database).dropDatabase();
      await cleanup.close();
    }
  },
);

test('conditional routing validates typed fields, uses ordered all/any rules and defaults safely', async () => {
  assert.equal(resolveWorkflowRouting(definition, { platform: 'Mac' }).queueName, 'Mac Support');
  assert.equal(
    resolveWorkflowRouting(definition, { platform: 'Windows' }).queueName,
    'Desktop Support',
  );
  const second = {
    id: 'accessories',
    match: 'any',
    conditions: [
      { fieldId: 'mouse', operator: 'equals', value: true },
      { fieldId: 'keyboard', operator: 'equals', value: true },
    ],
    action: 'route',
    queueName: 'Accessories',
  };
  const workflow = { ...definition, routing: [...definition.routing, second] };
  assert.equal(
    resolveWorkflowRouting(workflow, { platform: 'Mac', mouse: true }).ruleId,
    'mac-support',
  );
  assert.equal(
    resolveWorkflowRouting(workflow, { platform: 'Windows', keyboard: true }).queueName,
    'Accessories',
  );
  assert.equal(
    resolveWorkflowRouting(
      { ...workflow, routing: [{ ...second, match: 'all' }] },
      { platform: 'Windows', keyboard: true },
    ).queueName,
    'Desktop Support',
  );
  assert.equal(
    resolveWorkflowRouting(
      {
        ...workflow,
        routing: [
          {
            ...second,
            conditions: [{ fieldId: 'platform', operator: 'not-equals', value: 'Mac' }],
          },
        ],
      },
      { platform: 'Windows' },
    ).queueName,
    'Accessories',
  );
  for (const condition of [
    { fieldId: 'unknown', operator: 'equals', value: 'Mac' },
    { fieldId: 'platform', operator: 'equals', value: 'Linux' },
    { fieldId: 'mouse', operator: 'equals', value: 'true' },
    { fieldId: 'platform', operator: 'eval', value: 'Mac' },
  ]) {
    assert.throws(() =>
      defineWorkflow({ ...definition, routing: [{ ...second, conditions: [condition] }] }),
    );
  }
  assert.throws(() => resolveWorkflowRouting(definition, { platform: 'Mac', queueName: 'Admin' }));
  const seen = [];
  await runWorkflow(
    workflow,
    {
      id: 'event',
      workspaceId: 'workspace',
      department: 'it',
      text: 'laptop',
      answers: { platform: 'Mac' },
    },
    {
      authorize: ({ step }) => {
        seen.push(step);
        return true;
      },
    },
  );
  assert.equal(seen[0].params.queueName, 'Mac Support');
  assert.equal(seen[0].action, 'handoff');
});
