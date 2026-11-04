import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { createIntegrationStore } from '../src/integrationStore.js';
import {
  getConnectorActions,
  saveConnectorActions,
  requireConnectorAction,
} from '../src/connectorActions.js';
import { slackWorkflowDestination } from '../src/slackWorkflowDestination.js';

test(
  'connector controls default on, isolate workspaces, reject stale edits and deny disabled actions',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const uri = process.env.TEST_MONGODB_URI;
    const database = `agentzuno_actions_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_DATABASE = database;
    const store = createIntegrationStore();
    const client = new MongoClient(uri);
    const admin = { id: 'owner', workspaceId: '123456789012345678901234', role: 'admin' };
    const source = {
      ownerId: admin.id,
      workspaceId: admin.workspaceId,
      provider: 'slack',
      bot: { identityBindings: [{ userId: 'person', slackUserId: 'U123' }] },
    };
    try {
      await store.ready();
      const original = await getConnectorActions(store, admin, 'slack');
      assert.equal(original.items.length, 3);
      assert.ok(original.items.every((item) => item.enabled));
      const actions = Object.fromEntries(
        original.items.map((item) => [item.id, item.id !== 'workflowNotifications']),
      );
      await saveConnectorActions(store, admin, 'slack', { version: 0, actions });
      await requireConnectorAction(store, source, 'receiveMessages');
      await assert.rejects(requireConnectorAction(store, source, 'workflowNotifications'), {
        status: 403,
      });
      await assert.rejects(saveConnectorActions(store, admin, 'slack', { version: 0, actions }), {
        status: 409,
      });
      await assert.rejects(
        saveConnectorActions(store, { ...admin, role: 'user' }, 'slack', { version: 1, actions }),
        { status: 403 },
      );
      await assert.rejects(
        saveConnectorActions(store, admin, 'slack', {
          version: 1,
          actions: { ...actions, unsafe: true },
        }),
        { status: 400 },
      );
      await assert.rejects(
        saveConnectorActions(store, admin, 'teams', { version: 0, actions: {} }),
        { status: 400 },
      );
      assert.ok(
        (await getConnectorActions(store, { ...admin, workspaceId: 'other' }, 'slack')).items.every(
          (item) => item.enabled,
        ),
      );
      await store.collection('users').insertOne({ id: admin.id, workspaceId: admin.workspaceId });
      await store.collection('helpdeskMembers').insertOne({
        ownerId: admin.id,
        workspaceId: admin.workspaceId,
        userId: 'person',
        role: 'user',
        active: true,
      });
      assert.equal(await slackWorkflowDestination(store, source, 'requester', 'person'), 'U123');
      assert.equal(await slackWorkflowDestination(store, source, 'U123', 'owner'), 'U123');
      await assert.rejects(slackWorkflowDestination(store, source, 'U999', 'person'), {
        status: 403,
      });
      await store
        .collection('helpdeskMembers')
        .updateOne({ userId: 'person' }, { $set: { active: false } });
      await assert.rejects(slackWorkflowDestination(store, source, 'requester', 'person'), {
        status: 403,
      });
    } finally {
      await client.connect();
      await client.db(database).dropDatabase();
      await client.close();
      await store.close();
    }
  },
);
