import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createIntegrationStore } from '../src/integrationStore.js';
import { applyAdminGroupAction } from '../src/adminGroupActions.js';

test('Admin chat creates scoped groups from explicit requests, audits and deduplicates without giving support roles administrative actions', async () => {
  const database = createMemoryDatabase(),
    store = createIntegrationStore(database);
  const owner = {
    id: new ObjectId().toString(),
    workspaceId: new ObjectId().toString(),
    email: 'admin@example.test',
  };
  await database.collection('users').insertOne(owner);
  const chat = {
    _id: new ObjectId(),
    ownerId: owner.id,
    workspaceId: owner.workspaceId,
    providerOwnerId: owner.id,
    responseId: crypto.randomUUID(),
    actionRole: 'admin',
    assistantType: 'admin',
    helpdeskPurpose: 'workflow',
    messages: [
      { role: 'user', text: 'Make me a group called App Support for routing application requests' },
    ],
  };
  const proposal =
    'Review this proposal\n```group\n' +
    JSON.stringify({
      name: 'App Support',
      description: 'Application support',
      routingInstructions: 'Route application requests here',
      assignmentEnabled: true,
      approvalEnabled: false,
    }) +
    '\n```';
  const text = await applyAdminGroupAction(store, chat, proposal);
  assert.match(text, /^Created \[App Support\]\(\/workspace\//);
  const group = await database
    .collection('approvalGroups')
    .findOne({ ownerId: owner.id, workspaceId: owner.workspaceId, name: 'App Support' });
  assert.equal(group.assignmentEnabled, true);
  assert.equal(group.approvalEnabled, false);
  assert.deepEqual(group.userIds, []);
  assert.equal(group.createdFromChat.responseId, chat.responseId);
  assert.match(await applyAdminGroupAction(store, chat, proposal), /^Created/);
  assert.equal(
    await database.collection('approvalGroups').countDocuments({ name: 'App Support' }),
    1,
  );
  assert.equal(
    await database
      .collection('governanceAudit')
      .countDocuments({ action: 'admin-chat-create-group', outcome: 'completed' }),
    1,
  );
  assert.match(
    await applyAdminGroupAction(store, { ...chat, responseId: crypto.randomUUID() }, proposal),
    /^Found the existing group/,
  );
  assert.match(
    await applyAdminGroupAction(
      store,
      {
        ...chat,
        responseId: crypto.randomUUID(),
        messages: [{ role: 'user', text: 'Create a group named Desktop Support' }],
      },
      'Please click Create Queue',
    ),
    /^Created \[Desktop Support\]/,
  );
  const count = await database.collection('approvalGroups').countDocuments();
  assert.match(
    await applyAdminGroupAction(
      store,
      { ...chat, messages: [{ role: 'user', text: 'Describe App Support' }] },
      proposal,
    ),
    /Tell me the name/,
  );
  assert.match(
    await applyAdminGroupAction(
      store,
      { ...chat, messages: [...chat.messages, { role: 'user', text: "Don't create it" }] },
      proposal,
    ),
    /Tell me the name/,
  );
  await assert.rejects(applyAdminGroupAction(store, { ...chat, actionRole: 'user' }, proposal), {
    status: 403,
  });
  await assert.rejects(
    applyAdminGroupAction(store, { ...chat, providerOwnerId: new ObjectId().toString() }, proposal),
    { status: 403 },
  );
  assert.equal(
    await applyAdminGroupAction(
      store,
      { ...chat, assistantType: 'support', helpdeskPurpose: 'support' },
      proposal,
    ),
    proposal,
  );
  assert.equal(await database.collection('approvalGroups').countDocuments(), count);
  await store.close();
});

test('conditional task routing creates a missing named group before generation without requiring a group code fence', async () => {
  const database = createMemoryDatabase(),
    store = createIntegrationStore(database);
  const owner = {
    id: new ObjectId().toString(),
    workspaceId: new ObjectId().toString(),
    email: 'admin@example.test',
  };
  await database.collection('users').insertOne(owner);
  const chat = {
    _id: new ObjectId(),
    ownerId: owner.id,
    workspaceId: owner.workspaceId,
    providerOwnerId: owner.id,
    responseId: crypto.randomUUID(),
    actionRole: 'admin',
    assistantType: 'admin',
    helpdeskPurpose: 'workflow',
    messages: [
      {
        role: 'user',
        text: 'add a step to route a task to desktop support as well, and if the group doesnt exist create it',
      },
    ],
  };
  assert.match(await applyAdminGroupAction(store, chat, ''), /^Created \[Desktop Support\]/);
  assert.match(
    await applyAdminGroupAction(store, chat, 'Added the task'),
    /^Created \[Desktop Support\]/,
  );
  assert.equal(
    await database.collection('approvalGroups').countDocuments({ name: 'Desktop Support' }),
    1,
  );
  assert.equal(await database.collection('helpdeskTasks').countDocuments({}), 0);
  const declined = {
    ...chat,
    responseId: crypto.randomUUID(),
    messages: [
      {
        role: 'user',
        text: "route a task to Other Support and if the group doesn't exist do not create it",
      },
    ],
  };
  await applyAdminGroupAction(store, declined, '');
  assert.equal(
    await database.collection('approvalGroups').countDocuments({ name: 'Other Support' }),
    0,
  );
});
