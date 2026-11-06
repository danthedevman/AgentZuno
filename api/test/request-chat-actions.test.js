import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { createHelpdeskService } from '../src/requests/helpdesk.js';
import {
  allowedRequestActions,
  validateRequestAction,
  stripRequestAction,
} from '../src/requests/requestChatActions.js';

test('request action proposals are bounded by ownership and role and hidden during streaming', () => {
  const user = { id: 'employee', role: 'user' };
  const request = { requesterId: user.id, status: 'open', queueName: 'Support' };
  assert.deepEqual(allowedRequestActions(user, request), ['comment']);
  assert.throws(
    () => validateRequestAction(user, request, { action: 'update', status: 'resolved' }),
    { status: 403 },
  );
  assert.throws(
    () => validateRequestAction(user, request, { action: 'comment', text: 'Hi', userId: 'other' }),
    { status: 400 },
  );
  assert.deepEqual(allowedRequestActions({ ...user, role: 'read-only' }, request), []);
  assert.deepEqual(allowedRequestActions(user, { ...request, requesterId: 'other' }), []);
  assert.equal(
    stripRequestAction('Review this\n```request-action\n{"action":"comment"'),
    'Review this',
  );
  assert.ok(
    allowedRequestActions({ ...user, role: 'agent', queues: ['Support'] }, request).includes(
      'work-note',
    ),
  );
});

test(
  'confirmed chat actions use current permissions, request versions and one-time claims',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const uri = process.env.TEST_MONGODB_URI;
    const database = `agentzuno_request_actions_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_DATABASE = database;
    const store = createIntegrationStore();
    const client = new MongoClient(uri);
    const user = {
      id: 'employee',
      helpdeskOwnerId: 'owner',
      workspaceId: 'workspace',
      role: 'user',
    };
    const scope = { ownerId: 'owner', workspaceId: user.workspaceId };
    const id = new ObjectId(),
      chatId = new ObjectId();
    const chats = {
      get: async (actor, value) => {
        const chat = await store
          .collection('chats')
          .findOne({ _id: new ObjectId(value), ownerId: actor.id, workspaceId: actor.workspaceId });
        if (!chat) throw Object.assign(new Error('Chat not found'), { status: 404 });
        return chat;
      },
    };
    const service = createHelpdeskService(store, chats);
    try {
      await store.ready();
      await store.collection('helpdeskRequests').insertOne({
        _id: id,
        ...scope,
        requesterId: user.id,
        chatId: String(chatId),
        number: 'REQ-TEST',
        status: 'open',
        version: 1,
        events: [],
        messages: [],
        description: 'Fixture',
      });
      const proposal = {
        action: 'comment',
        text: 'Please deliver tomorrow.',
        requestId: String(id),
        number: 'REQ-TEST',
        version: 1,
        state: 'pending',
      };
      await store.collection('chats').insertOne({
        _id: chatId,
        ownerId: user.id,
        workspaceId: user.workspaceId,
        helpdeskPurpose: 'support',
        status: 'complete',
        messages: [{ id: 'reply', role: 'assistant', requestAction: proposal }],
      });
      await assert.rejects(
        service.applyChatAction({ ...user, id: 'other' }, String(chatId), { messageId: 'reply' }),
        { status: 404 },
      );
      await assert.rejects(
        service.applyChatAction({ ...user, role: 'read-only' }, String(chatId), {
          messageId: 'reply',
        }),
        { status: 403 },
      );
      await service.applyChatAction(user, String(chatId), { messageId: 'reply' });
      const request = await store.collection('helpdeskRequests').findOne({ _id: id });
      assert.equal(request.messages.length, 1);
      assert.equal(request.messages[0].authorId, user.id);
      assert.equal(request.messages[0].text, proposal.text);
      await assert.rejects(service.applyChatAction(user, String(chatId), { messageId: 'reply' }), {
        status: 409,
      });
      await store
        .collection('chats')
        .updateOne(
          { _id: chatId },
          { $push: { messages: { id: 'stale', role: 'assistant', requestAction: proposal } } },
        );
      await assert.rejects(service.applyChatAction(user, String(chatId), { messageId: 'stale' }), {
        status: 409,
      });
      assert.equal(
        (await store.collection('helpdeskRequests').findOne({ _id: id })).messages.length,
        1,
      );
    } finally {
      await client.connect();
      await client.db(database).dropDatabase();
      await client.close();
      await store.close();
    }
  },
);
