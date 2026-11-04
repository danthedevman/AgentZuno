import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { createApi } from '../src/app.js';
import { defineDataTable, createAdminData } from '../src/adminData.js';
import { createIntegrationStore } from '../src/integrationStore.js';
import {
  workforceFromScim,
  enterpriseUserSchema,
  importWorkforceProfile,
} from '../src/workforceProfiles.js';
const definition = {
  name: 'Routing Map',
  description: 'Department routing',
  fields: [
    { id: 'name', label: 'Name', type: 'text', required: true },
    { id: 'owner', label: 'Owner', type: 'reference', required: false, referenceTable: 'users' },
    { id: 'weight', label: 'Weight', type: 'number', required: true },
  ],
};
test('data schemas and SCIM enterprise fields reject unsupported values', () => {
  assert.deepEqual(defineDataTable(definition), definition);
  assert.throws(
    () =>
      defineDataTable({
        ...definition,
        fields: [{ id: 'unsafe', label: 'Unsafe', type: 'eval', required: true }],
      }),
    { status: 400 },
  );
  assert.throws(
    () => defineDataTable({ ...definition, fields: [...definition.fields, definition.fields[0]] }),
    { status: 400 },
  );
  const profile = workforceFromScim({
    title: 'Engineer',
    name: { givenName: 'Pat' },
    [enterpriseUserSchema]: {
      department: 'Engineering',
      employeeNumber: 'E-100',
      manager: { value: '000000000000000000000001' },
    },
  });
  assert.equal(profile.department, 'Engineering');
  assert.equal(profile.managerDirectoryId, '000000000000000000000001');
  assert.throws(() => workforceFromScim({ [enterpriseUserSchema]: { role: 'admin' } }), {
    status: 400,
  });
});
test(
  'Data and workforce HTTP routes enforce Admin writes, scoped references, versioned edits and server list queries',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const uri = process.env.TEST_MONGODB_URI;
    const database = `agentzuno_admin_data_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_DATABASE = database;
    const cleanup = new MongoClient(uri);
    const app = createApi();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    async function call(actor, path, method = 'GET', body) {
      const response = await fetch(base + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(actor ? { cookie: actor.cookie, 'X-Workspace-Id': actor.workspaceId } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get('set-cookie')?.split(';')[0],
      };
    }
    async function register(name) {
      const result = await call(null, '/auth/register', 'POST', {
        email: `${name}@data.test`,
        password: 'Fictional-data-test-password!',
      });
      assert.equal(result.status, 201);
      return { ...result.body.user, cookie: result.cookie };
    }
    try {
      const admin = await register('admin');
      const employee = await register('employee');
      const outsider = await register('outsider');
      const ownEmployee = { ...employee };
      assert.equal(
        (
          await call(admin, '/helpdesk/members', 'POST', {
            email: employee.email,
            role: 'user',
            active: true,
            queues: [],
            canApprove: false,
          })
        ).status,
        201,
      );
      employee.workspaceId = admin.workspaceId;
      const agent = await register('queue-agent');
      assert.equal(
        (
          await call(admin, '/helpdesk/members', 'POST', {
            email: agent.email,
            role: 'agent',
            active: true,
            queues: [],
            canApprove: false,
          })
        ).status,
        201,
      );
      const asset = await call(admin, '/helpdesk/data/tables/ref-asset/records', 'POST', {
        values: { name: 'Fixture Laptop', 'asset-tag': 'TEST-1', 'assigned-to': employee.id },
      });
      assert.equal(asset.status, 201);
      assert.equal(
        (
          await call(employee, '/helpdesk/data/tables/ref-asset/records', 'POST', {
            values: { name: 'Denied' },
          })
        ).status,
        403,
      );
      assert.equal(
        (await call(admin, '/helpdesk/data/tables/ref-asset/records?list=1&q=Fixture')).body.total,
        1,
      );
      const queueInput = {
        name: 'Desktop Support',
        description: 'Device requests',
        routingInstructions: 'Help with laptops.\nEscalate repairs through a published workflow.',
        agentIds: [agent.id],
      };
      assert.equal((await call(employee, '/helpdesk/queues', 'POST', queueInput)).status, 403);
      assert.equal(
        (await call(admin, '/helpdesk/queues', 'POST', { ...queueInput, agentIds: [outsider.id] }))
          .status,
        400,
      );
      const queue = await call(admin, '/helpdesk/queues', 'POST', queueInput);
      assert.equal(queue.status, 201);
      assert.deepEqual(queue.body.agentIds, [agent.id]);
      assert.equal(
        (await call(admin, '/helpdesk/members')).body
          .find((member) => member.userId === agent.id)
          .queues.includes('Desktop Support'),
        true,
      );
      assert.equal((await call(outsider, '/helpdesk/queues')).body.length, 0);
      const queues = await call(admin, '/helpdesk/queues?list=1&sort=Queue&q=Desktop');
      assert.equal(queues.body.total, 1);
      assert.equal(
        (
          await call(admin, `/helpdesk/queues/${queue.body.id}`, 'PUT', {
            ...queueInput,
            version: 0,
          })
        ).status,
        409,
      );
      const clearedQueue = await call(admin, `/helpdesk/queues/${queue.body.id}`, 'PUT', {
        ...queueInput,
        agentIds: [],
        version: 1,
      });
      assert.equal(clearedQueue.status, 200);
      assert.equal(
        (await call(admin, '/helpdesk/members')).body.find((member) => member.userId === agent.id)
          .queues.length,
        0,
      );
      const bootstrap = await call(admin, `/workspaces/${admin.workspaceId}?sections=none`);
      assert.equal(bootstrap.status, 200);
      assert.deepEqual(bootstrap.body.articles, []);
      assert.deepEqual(bootstrap.body.knowledgeBases, []);
      const baseOnly = await call(
        admin,
        `/workspaces/${admin.workspaceId}?sections=knowledgeBases`,
      );
      assert.equal(baseOnly.body.knowledgeBases.length, 1);
      assert.deepEqual(baseOnly.body.articles, []);
      assert.equal(
        (await call(admin, `/workspaces/${admin.workspaceId}?sections=credentials`)).status,
        400,
      );
      const baseDetail = await call(admin, `/helpdesk/knowledge-bases/${admin.workspaceId}`);
      assert.equal(baseDetail.status, 200);
      assert.equal(baseDetail.body.name, 'General');
      assert.equal(
        (await call(outsider, `/helpdesk/knowledge-bases/${admin.workspaceId}`)).status,
        404,
      );
      const created = await call(admin, '/helpdesk/data/tables', 'POST', { definition });
      assert.equal(created.status, 201);
      const tableId = created.body.id;
      assert.equal((await call(employee, '/helpdesk/data/tables')).status, 403);
      assert.equal((await call(outsider, `/helpdesk/data/tables/${tableId}`)).status, 404);
      assert.equal(
        (
          await call(admin, `/helpdesk/data/tables/${tableId}/records`, 'POST', {
            values: { name: 'Desktop', weight: 'wrong' },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call(admin, `/helpdesk/data/tables/${tableId}/records`, 'POST', {
            values: { name: 'Desktop', weight: 10, owner: outsider.id },
          })
        ).status,
        400,
      );
      const row = await call(admin, `/helpdesk/data/tables/${tableId}/records`, 'POST', {
        values: { name: 'Desktop', weight: 10, owner: employee.id },
      });
      assert.equal(row.status, 201);
      assert.equal(
        (await call(admin, `/helpdesk/data/tables/${tableId}/records/${row.body.id}`)).body.values
          .name,
        'Desktop',
      );
      assert.equal(
        (await call(outsider, `/helpdesk/data/tables/${tableId}/records/${row.body.id}`)).status,
        404,
      );
      assert.equal(
        (await call(employee, `/helpdesk/data/tables/${tableId}/records/${row.body.id}`)).status,
        403,
      );
      const listed = await call(
        admin,
        `/helpdesk/data/tables/${tableId}/records?list=1&sort=weight&direction=desc&q=Desktop`,
      );
      assert.equal(listed.status, 200);
      assert.equal(listed.body.total, 1);
      assert.ok(listed.body.rows[0].labels.owner.includes(employee.email));
      assert.equal(
        (
          await call(admin, `/helpdesk/data/tables/${tableId}/records/${row.body.id}`, 'PUT', {
            version: 0,
            values: { name: 'New', weight: 1 },
          })
        ).status,
        409,
      );
      const department = await call(admin, '/helpdesk/reference-records', 'POST', {
        type: 'department',
        name: 'Engineering',
      });
      assert.equal(department.status, 201);
      const builtinTable = (await call(admin, '/helpdesk/data/tables/ref-department')).body;
      const schemaEdit = await call(admin, '/helpdesk/data/tables/ref-department', 'PUT', {
        version: builtinTable.version,
        definition: {
          name: builtinTable.name,
          description: builtinTable.description,
          fields: [
            ...builtinTable.fields,
            { id: 'support-code', label: 'Support Code', type: 'text', required: false },
          ],
        },
      });
      assert.equal(schemaEdit.status, 200);
      assert.equal(schemaEdit.body.fields.at(-1).id, 'support-code');
      assert.equal(
        (await call(outsider, '/helpdesk/data/tables/ref-department')).body.fields.some(
          (field) => field.id === 'support-code',
        ),
        false,
      );
      const profile = await call(admin, `/helpdesk/workforce-profiles/${employee.id}`, 'PUT', {
        version: 0,
        fields: { title: 'Engineer', department: department.body.id, manager: admin.id },
      });
      assert.equal(profile.status, 200);
      assert.equal(
        (await call(employee, `/helpdesk/workforce-profiles/${employee.id}`)).body.labels[
          department.body.id
        ],
        'Engineering',
      );
      assert.equal((await call(employee, `/helpdesk/workforce-profiles/${admin.id}`)).status, 403);
      assert.equal(
        (
          await call(employee, `/helpdesk/workforce-profiles/${employee.id}`, 'PUT', {
            version: 1,
            fields: {},
          })
        ).status,
        403,
      );
      const renamed = await call(employee, `/helpdesk/workforce-profiles/${employee.id}`, 'PUT', {
        version: 1,
        name: 'Updated Employee',
      });
      assert.equal(renamed.status, 200);
      assert.equal(renamed.body.name, 'Updated Employee');
      assert.equal(renamed.body.fields.title, 'Engineer');
      assert.equal(
        (
          await call(employee, `/helpdesk/workforce-profiles/${employee.id}`, 'PUT', {
            version: 1,
            name: ' ',
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call(employee, `/helpdesk/workforce-profiles/${admin.id}`, 'PUT', {
            version: 1,
            name: 'Other',
          })
        ).status,
        403,
      );
      const foreign = await call(outsider, '/helpdesk/reference-records', 'POST', {
        type: 'department',
        name: 'Foreign',
      });
      assert.equal(
        (
          await call(admin, `/helpdesk/workforce-profiles/${employee.id}`, 'PUT', {
            version: 1,
            fields: { department: foreign.body.id },
          })
        ).status,
        400,
      );
      const users = await call(admin, '/helpdesk/members?list=1&sort=Department&q=Engineering');
      assert.equal(users.status, 200);
      assert.equal(users.body.total, 1);
      assert.equal(users.body.rows[0].userId, employee.id);
      assert.equal(
        (await call(ownEmployee, `/helpdesk/workforce-profiles/${employee.id}`)).body.fields
          .department,
        '',
      );
      const flowDefinition = {
        version: 1,
        name: 'Laptop Order',
        permissions: { audience: 'restricted', userIds: [employee.id], queueNames: [] },
        trigger: { department: 'it', phrases: ['laptop'] },
        steps: [{ id: 'route', action: 'route', params: { queueName: 'general' } }],
        form: {
          title: 'Laptop Order',
          fields: [
            {
              id: 'platform',
              label: 'Platform',
              type: 'select',
              required: true,
              options: ['Mac', 'Windows'],
            },
          ],
        },
      };
      await call(admin, '/helpdesk/queues', 'POST', {
        name: 'general',
        description: '',
        routingInstructions: '',
        agentIds: [],
      });
      const workflowInput = {
        name: flowDefinition.name,
        department: 'it',
        keywords: ['laptop'],
        action: 'route',
        queueName: 'general',
        enabled: true,
        intent: 'publish',
        definition: flowDefinition,
      };
      const published = await call(admin, '/helpdesk/workflows', 'POST', workflowInput);
      assert.equal(published.status, 201);
      assert.equal(
        (
          await call(admin, '/helpdesk/workflows', 'POST', {
            ...workflowInput,
            definition: {
              ...flowDefinition,
              permissions: { audience: 'restricted', userIds: [outsider.id], queueNames: [] },
            },
          })
        ).status,
        400,
      );
      const restrictedChat = await call(
        { ...agent, workspaceId: admin.workspaceId },
        '/helpdesk/support/conversations',
        'POST',
        { requestId: randomUUID(), text: 'I need a laptop' },
      );
      assert.equal(restrictedChat.status, 202);
      assert.equal(
        (
          await call(
            { ...agent, workspaceId: admin.workspaceId },
            `/helpdesk/support/conversations/${restrictedChat.body.id}`,
          )
        ).body.requestForm,
        null,
      );

      const supportChat = await call(employee, '/helpdesk/support/conversations', 'POST', {
        requestId: randomUUID(),
        text: 'I need a laptop',
      });
      assert.equal(supportChat.status, 202);
      // Complete the fixture queue state without calling a real model provider.
      await cleanup
        .db(database)
        .collection('chats')
        .updateOne({ _id: new ObjectId(supportChat.body.id) }, { $set: { status: 'complete' } });
      const offered = (
        await call(employee, `/helpdesk/support/conversations/${supportChat.body.id}`)
      ).body.requestForm;
      const submit = {
        workflowId: published.body.id,
        workflowVersion: offered.workflowVersion,
        answers: { platform: 'Mac' },
      };
      const submitted = await call(
        employee,
        `/helpdesk/support/conversations/${supportChat.body.id}/form`,
        'POST',
        submit,
      );
      assert.equal(submitted.status, 201);
      const requestDetails = (await call(employee, `/helpdesk/requests/${submitted.body.id}`)).body;
      assert.equal(requestDetails.workflow.name, flowDefinition.name);
      assert.equal(requestDetails.workflow.id, published.body.id);
      assert.equal(requestDetails.workflow.canOpen, false);
      assert.equal(
        (await call(admin, `/helpdesk/requests/${submitted.body.id}`)).body.workflow.canOpen,
        true,
      );
      assert.equal(
        (
          await call(
            employee,
            `/helpdesk/support/conversations/${supportChat.body.id}/form`,
            'POST',
            submit,
          )
        ).body.id,
        submitted.body.id,
      );
      const confirmation = (
        await call(employee, `/helpdesk/support/conversations/${supportChat.body.id}`)
      ).body;
      assert.equal(confirmation.requestForm, null);
      assert.equal(confirmation.submittedForm.requestId, submitted.body.id);
      assert.equal(confirmation.submittedForm.number, submitted.body.number);
      const changedDefinition = {
        ...flowDefinition,
        name: 'Revised Laptop Workflow',
        form: { ...flowDefinition.form, title: 'Revised Laptop Order' },
      };
      const savedDraft = await call(admin, `/helpdesk/workflows/${published.body.id}`, 'PUT', {
        ...workflowInput,
        name: changedDefinition.name,
        definition: changedDefinition,
        enabled: false,
        intent: 'draft',
        version: 1,
      });
      assert.equal(savedDraft.status, 200);
      assert.equal(savedDraft.body.enabled, true);
      assert.equal(savedDraft.body.publishedRevision, 1);
      assert.equal(savedDraft.body.publishedConfig.definition.form.title, 'Laptop Order');
      assert.equal(
        (await call(employee, `/helpdesk/requests/${submitted.body.id}`)).body.workflow.name,
        flowDefinition.name,
      );
      assert.equal(
        (await call(admin, `/helpdesk/requests/${submitted.body.id}`)).body.workflow.name,
        changedDefinition.name,
      );
      const republished = await call(admin, `/helpdesk/workflows/${published.body.id}`, 'PUT', {
        ...workflowInput,
        name: changedDefinition.name,
        definition: changedDefinition,
        version: 2,
      });
      assert.equal(republished.status, 200);
      assert.equal(republished.body.publishedRevision, 3);
      const designChat = await call(admin, '/helpdesk/workflow-conversations', 'POST', {
        requestId: randomUUID(),
        text: 'Improve laptop order routing',
        workflowId: published.body.id,
      });
      assert.equal(designChat.status, 202);
      const history = await call(
        admin,
        `/helpdesk/workflow-conversations?list=1&workflowId=${published.body.id}&sort=Updated`,
      );
      assert.equal(history.status, 200);
      assert.equal(history.body.total, 1);
      assert.equal(history.body.rows[0].id, designChat.body.id);
      assert.equal(
        (await call(employee, `/helpdesk/workflow-conversations?workflowId=${published.body.id}`))
          .status,
        403,
      );
      assert.equal(
        (
          await call(admin, `/helpdesk/workflows/${published.body.id}`, 'PUT', {
            ...workflowInput,
            name: changedDefinition.name,
            definition: changedDefinition,
            enabled: false,
            intent: 'unpublish',
            version: 3,
          })
        ).body.enabled,
        false,
      );
      const chat = await call(admin, '/helpdesk/data/conversations', 'POST', {
        requestId: randomUUID(),
        text: 'Build a departments table',
      });
      assert.equal(chat.status, 202);
      assert.equal(
        (await call(employee, `/helpdesk/data/conversations/${chat.body.id}`)).status,
        403,
      );
      assert.equal(
        (await call(admin, `/helpdesk/data/conversations/${chat.body.id}`)).body.messages[0].text,
        'Build a departments table',
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.close();
      await cleanup.db(database).dropDatabase();
      await cleanup.close();
    }
  },
);

test(
  'built-in workforce tables support scoped custom fields, safe schema edits and persistent record values',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    const uri = process.env.TEST_MONGODB_URI;
    const database = `agentzuno_builtin_fields_${randomUUID().replaceAll('-', '')}`;
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_DATABASE = database;
    const store = createIntegrationStore();
    const cleanup = new MongoClient(uri);
    const admin = { id: 'owner', workspaceId: 'workspace', role: 'admin' };
    const other = { id: 'other', workspaceId: 'other-workspace', role: 'admin' };
    const service = createAdminData(store);
    try {
      await store.ready();
      const defaults = await service.tables(admin);
      assert.equal(defaults.length, 18);
      assert.ok(defaults.some((table) => table.id === 'ref-task'));
      assert.ok(defaults.some((table) => table.id === 'ref-request'));
      assert.ok(defaults.some((table) => table.id === 'ref-catalog-category'));
      assert.ok(defaults.some((table) => table.id === 'ref-user'));
      assert.ok(defaults.some((table) => table.id === 'ref-group'));
      for (const table of defaults) assert.ok(table.protectedFields.length >= 2);
      assert.ok(
        defaults
          .find((table) => table.id === 'ref-location')
          .fields.some((field) => field.id === 'address'),
      );
      assert.ok(
        defaults
          .find((table) => table.id === 'ref-cost-center')
          .fields.some((field) => field.id === 'budget' && field.type === 'number'),
      );
      const initial = await service.table(admin, 'ref-department');
      const custom = { id: 'support-code', label: 'Support Code', type: 'text', required: false };
      const input = {
        definition: {
          name: initial.name,
          description: initial.description,
          fields: [...initial.fields, custom],
        },
        version: initial.version,
      };
      await assert.rejects(service.saveTable({ ...admin, role: 'user' }, 'ref-department', input), {
        status: 403,
      });
      const saved = await service.saveTable(admin, 'ref-department', input);
      assert.equal(saved.id, 'ref-department');
      assert.equal(saved.version, 2);
      assert.equal(
        (await service.table(other, 'ref-department')).fields.some(
          (field) => field.id === custom.id,
        ),
        false,
      );
      assert.equal(
        (await service.tables(admin)).filter((table) => table.id === 'ref-department').length,
        1,
      );
      await assert.rejects(service.saveTable(admin, 'ref-department', input), { status: 409 });
      const values = {
        name: 'Engineering',
        description: 'Engineering team',
        code: 'ENG',
        'support-code': 'DESKTOP',
      };
      const created = await service.saveRecord(admin, 'ref-department', null, { values });
      assert.equal(created.version, 1);
      await assert.rejects(
        service.saveRecord(admin, 'ref-department', null, {
          values: { ...values, 'support-code': 'OVERWRITE' },
        }),
        { status: 409 },
      );
      assert.equal(
        (await service.records(admin, 'ref-department'))[0].values['support-code'],
        'DESKTOP',
      );
      assert.equal((await service.records(other, 'ref-department')).length, 0);
      await assert.rejects(
        service.saveRecord(admin, 'ref-department', created.id, { version: 0, values }),
        { status: 409 },
      );
      const updated = await service.saveRecord(admin, 'ref-department', created.id, {
        version: 1,
        values: { ...values, 'support-code': 'HELP' },
      });
      assert.equal(updated.version, 2);
      await assert.rejects(
        service.saveTable(admin, 'ref-department', {
          version: 2,
          definition: {
            ...input.definition,
            fields: saved.fields.filter((field) => field.id !== 'name'),
          },
        }),
        { status: 409 },
      );
      await assert.rejects(
        service.saveTable(admin, 'ref-department', {
          version: 2,
          definition: {
            ...input.definition,
            fields: saved.fields.map((field) =>
              field.id === custom.id ? { ...field, type: 'number' } : field,
            ),
          },
        }),
        { status: 409 },
      );
      await assert.rejects(
        service.saveTable(admin, 'ref-department', {
          version: 2,
          definition: {
            ...input.definition,
            fields: [
              ...saved.fields,
              { id: 'required-code', label: 'Required Code', type: 'text', required: true },
            ],
          },
        }),
        { status: 409 },
      );
      await assert.rejects(
        service.saveTable(admin, 'ref-department', {
          version: 2,
          confirmedRemovedFieldIds: ['email'],
          definition: {
            ...input.definition,
            fields: saved.fields.filter((field) => field.id !== 'email'),
          },
        }),
        { status: 409 },
      );
      const renamed = await service.saveTable(admin, 'ref-department', {
        version: 2,
        confirmedRemovedFieldIds: ['email'],
        definition: {
          ...input.definition,
          fields: saved.fields.map((field) =>
            field.id === custom.id ? { ...field, label: 'Help Desk Code' } : field,
          ),
        },
      });
      assert.equal(renamed.version, 3);
      assert.equal(renamed.fields.find((field) => field.id === custom.id).label, 'Help Desk Code');
      await importWorkforceProfile(
        store,
        { ownerId: admin.id, workspaceId: admin.workspaceId, issuer: 'https://fixture.example' },
        'employee',
        { department: 'Engineering' },
      );
      const reloaded = createAdminData(store);
      const rows = await reloaded.records(admin, 'ref-department');
      assert.equal(rows[0].values['support-code'], 'HELP');
      assert.equal(rows[0].values.code, 'ENG');
      assert.equal(
        (await store.collection('workforceProfiles').findOne({ userId: 'employee' })).department,
        created.id,
      );
      const foreign = await service.saveRecord(other, 'ref-organization', null, {
        values: { name: 'Foreign Org' },
      });
      await assert.rejects(
        service.saveRecord(admin, 'ref-department', created.id, {
          version: 2,
          values: { ...values, organization: foreign.id },
        }),
        { status: 400 },
      );
      const old = await service.records(admin, 'ref-organization');
      assert.equal(old.length, 0);
      // Records created by profile provisioning before this feature retain editable version-zero support.
      await importWorkforceProfile(
        store,
        { ownerId: admin.id, workspaceId: admin.workspaceId, issuer: 'https://fixture.example' },
        'employee',
        { organization: 'Legacy Org' },
      );
      const legacy = (await service.records(admin, 'ref-organization'))[0];
      assert.equal(legacy.version, 0);
      assert.equal(
        (
          await service.saveRecord(admin, 'ref-organization', legacy.id, {
            version: 0,
            values: { name: 'Legacy Org', code: 'ORG' },
          })
        ).version,
        1,
      );
    } finally {
      await store.close();
      await cleanup.db(database).dropDatabase();
      await cleanup.close();
    }
  },
);
