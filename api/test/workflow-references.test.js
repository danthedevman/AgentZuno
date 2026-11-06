import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { createIntegrationStore } from '../src/storage/integrationStore.js';
import { createAdminData } from '../src/data/adminData.js';
import { defineRequestForm, validateFormAnswers } from '../sdk/workflows/index.js';
import {
  validateWorkflowReferences,
  workflowReferenceOptions,
  validateWorkflowReferenceAnswers,
} from '../src/workflows/workflowReferences.js';

test(
  'workflow reference forms validate targets and expose only scoped lookup labels and accessible requests',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
    process.env.MONGODB_DATABASE = 'az_reference_' + randomUUID().replaceAll('-', '');
    const client = new MongoClient(process.env.MONGODB_URI),
      store = createIntegrationStore();
    const admin = {
      id: new ObjectId().toString(),
      workspaceId: new ObjectId().toString(),
      role: 'admin',
    };
    const user = {
      id: new ObjectId().toString(),
      helpdeskOwnerId: admin.id,
      workspaceId: admin.workspaceId,
      role: 'user',
    };
    const scope = { ownerId: admin.id, workspaceId: admin.workspaceId };
    try {
      await store.ready();
      await store.collection('users').insertMany([
        { id: user.id, name: 'Alex Employee', email: 'private@example.test' },
        { id: 'outsider', name: 'Other Workspace', email: 'other@example.test' },
      ]);
      await store.collection('helpdeskMembers').insertMany([
        { ...scope, userId: user.id, email: 'private@example.test', role: 'user', active: true },
        { ownerId: 'different', workspaceId: 'different', userId: 'outsider', active: true },
      ]);
      const data = createAdminData(store);
      const table = await data.saveTable(admin, null, {
        definition: {
          name: 'Locations',
          description: 'Office locations',
          fields: [{ id: 'name', label: 'Name', type: 'text', required: true }],
        },
      });
      const record = await data.saveRecord(admin, table.id, null, {
        values: { name: 'London Office' },
      });
      const form = defineRequestForm({
        title: 'Office Help',
        fields: [
          {
            id: 'employee',
            label: 'Employee',
            type: 'reference',
            referenceTable: 'users',
            required: true,
          },
          {
            id: 'office',
            label: 'Office',
            type: 'reference',
            referenceTable: table.id,
            required: true,
          },
        ],
      });
      await validateWorkflowReferences(store, admin, { form });
      assert.throws(
        () =>
          defineRequestForm({
            title: 'Invalid',
            fields: [{ id: 'user', label: 'User', type: 'reference', required: true }],
          }),
        /reference table/,
      );
      await assert.rejects(
        validateWorkflowReferences(store, admin, {
          form: { fields: [{ type: 'reference', referenceTable: new ObjectId().toString() }] },
        }),
        { status: 400 },
      );
      const workflow = { definition: { form } };
      const users = await workflowReferenceOptions(store, user, workflow, form.fields[0]);
      assert.deepEqual(users, [{ value: user.id, label: 'Alex Employee' }]);
      assert.ok(!JSON.stringify(users).includes('private@example.test'));
      const options = await workflowReferenceOptions(
        store,
        user,
        workflow,
        form.fields[1],
        'london',
      );
      assert.deepEqual(options, [{ value: record.id, label: 'London Office' }]);
      const answers = validateFormAnswers(form, { employee: user.id, office: record.id });
      await validateWorkflowReferenceAnswers(store, user, workflow, answers);
      assert.equal(answers[1].displayValue, 'London Office');
      assert.deepEqual(answers[1].reference, { table: table.id, id: record.id });
      await assert.rejects(
        validateWorkflowReferenceAnswers(
          store,
          user,
          workflow,
          validateFormAnswers(form, { employee: 'outsider', office: record.id }),
        ),
        { status: 400 },
      );
      const own = new ObjectId(),
        hidden = new ObjectId();
      await store.collection('helpdeskRequests').insertMany([
        {
          ...scope,
          _id: own,
          requestId: randomUUID(),
          requesterId: user.id,
          title: 'My Request',
          status: 'open',
        },
        {
          ...scope,
          _id: hidden,
          requestId: randomUUID(),
          requesterId: 'someone-else',
          title: 'Private Request',
          status: 'open',
        },
      ]);
      const requestField = { id: 'request', type: 'reference', referenceTable: 'ref-request' };
      const requests = await workflowReferenceOptions(store, user, workflow, requestField);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].value, String(own));
      await store.collection('adminDataRecords').deleteOne({ _id: new ObjectId(record.id) });
      await assert.rejects(validateWorkflowReferenceAnswers(store, user, workflow, answers), {
        status: 400,
      });
    } finally {
      await store.close();
      await client.db(process.env.MONGODB_DATABASE).dropDatabase();
      await client.close();
    }
  },
);
