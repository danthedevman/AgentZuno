import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { createMemoryDatabase } from '../src/storage/memory.js';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { createAdminGroup } from '../src/identity/adminGroupActions.js';

test('typed group actions reuse the form service, audit creation, deduplicate and reject malformed or unauthorized calls', async () => {
  const database = createMemoryDatabase(),
    store = createIntegrationStore(database);
  const user = {
    id: String(new ObjectId()),
    workspaceId: String(new ObjectId()),
    email: 'admin@example.test',
  };
  await database.collection('users').insertOne(user);
  const chat = {
    _id: new ObjectId(),
    ownerId: user.id,
    workspaceId: user.workspaceId,
    providerOwnerId: user.id,
    responseId: crypto.randomUUID(),
    actionRole: 'admin',
    assistantType: 'admin',
    helpdeskPurpose: 'workflow',
  };
  const input = {
    name: 'IAM',
    description: 'Identity support',
    routingInstructions: 'Route identity requests here',
    assignmentEnabled: true,
    approvalEnabled: true,
  };
  const first = await createAdminGroup(store, chat, input);
  assert.equal(first.status, 'created');
  assert.ok(first.href.includes('/users/groups/'));
  assert.equal(first.approvalEnabled, true);
  assert.equal(first.assignmentEnabled, true);
  const second = await createAdminGroup(store, { ...chat, responseId: crypto.randomUUID() }, input);
  assert.equal(second.status, 'existing');
  assert.equal(second.id, first.id);
  assert.equal(
    await database
      .collection('governanceAudit')
      .countDocuments({ action: 'admin-chat-create-group', outcome: 'completed' }),
    1,
  );
  for (const invalid of [
    { ...input, name: { $ne: null } },
    { ...input, ownerId: 'other' },
    { ...input, approvalEnabled: 'true' },
    { ...input, name: 'x'.repeat(81) },
    { ...input, routingInstructions: [] },
  ])
    await assert.rejects(createAdminGroup(store, chat, invalid), { status: 400 });
  for (const role of ['user', 'agent', 'read-only'])
    await assert.rejects(createAdminGroup(store, { ...chat, actionRole: role }, input), {
      status: 403,
    });
  await assert.rejects(createAdminGroup(store, { ...chat, assistantType: 'support' }, input), {
    status: 403,
  });
  assert.equal(await database.collection('approvalGroups').countDocuments(), 1);
  await store.close();
});
