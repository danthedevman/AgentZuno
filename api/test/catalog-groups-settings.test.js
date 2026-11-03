import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import sharp from 'sharp';
import { createApi } from '../src/app.js';
import { chatUserContext } from '../src/chatUserContext.js';
import { workspaceGroups } from '../src/groups.js';
import { requireExistingQueues } from '../src/helpdeskQueues.js';
import { resolveWorkflowApprovers } from '../src/approvalTargets.js';

test(
  'catalog categories, group purposes, images, personal context and recent views enforce workspace access',
  { skip: !process.env.TEST_MONGODB_URI },
  async () => {
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
    process.env.MONGODB_DATABASE = `agentzuno_catalog_${randomUUID().replaceAll('-', '')}`;
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const db = client.db(process.env.MONGODB_DATABASE);
    const store = { ready: async () => {}, collection: (name) => db.collection(name) };
    const app = createApi();
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    async function call(
      cookie,
      path,
      method = 'GET',
      body,
      workspace,
      contentType = 'application/json',
    ) {
      const response = await fetch(origin + '/api' + path, {
        method,
        headers: {
          'Content-Type': contentType,
          ...(cookie ? { cookie } : {}),
          ...(workspace ? { 'X-Workspace-Id': workspace } : {}),
        },
        ...(body === undefined
          ? {}
          : { body: contentType === 'application/json' ? JSON.stringify(body) : body }),
      });
      return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get('set-cookie')?.split(';')[0],
      };
    }
    try {
      const admin = await call(null, '/auth/register', 'POST', {
        email: 'admin@catalog.test',
        password: 'Fictional-catalog-password!',
      });
      const other = await call(null, '/auth/register', 'POST', {
        email: 'other@catalog.test',
        password: 'Fictional-catalog-password!',
      });
      const workspace = admin.body.user.workspaceId;
      const adminId = admin.body.user.id;
      const actor = { id: adminId, workspaceId: workspace, role: 'admin' };
      const group = await call(
        admin.cookie,
        '/helpdesk/groups',
        'POST',
        {
          name: 'Desktop Support',
          description: 'Device team',
          routingInstructions: 'Hardware requests',
          userIds: [adminId],
          active: true,
          assignmentEnabled: true,
          approvalEnabled: false,
        },
        workspace,
      );
      assert.equal(group.status, 201, JSON.stringify(group.body));
      assert.equal(
        (await call(admin.cookie, '/helpdesk/queues', 'GET', undefined, workspace)).body[0].groupId,
        group.body.id,
      );
      await assert.rejects(
        resolveWorkflowApprovers(
          store,
          { ownerId: adminId, workspaceId: workspace, actorId: 'requester' },
          { target: 'group', groupId: group.body.id },
        ),
        /unavailable/,
      );
      const category = await call(
        admin.cookie,
        '/helpdesk/data/tables/ref-catalog-category/records',
        'POST',
        { values: { name: 'Equipment', description: 'Device requests', code: 'EQUIP' } },
        workspace,
      );
      assert.equal(category.status, 201, JSON.stringify(category.body));
      const categoryId = category.body.id;
      const image = await sharp({
        create: { width: 8, height: 8, channels: 4, background: '#818CF8' },
      })
        .png()
        .toBuffer();
      const upload = await call(
        admin.cookie,
        '/helpdesk/catalog-images',
        'POST',
        image,
        workspace,
        'image/png',
      );
      assert.equal(upload.status, 201, JSON.stringify(upload.body));
      const definition = {
        version: 1,
        name: 'MacBook Request',
        trigger: { department: 'it', phrases: ['macbook'] },
        steps: [{ id: 'route', action: 'route', params: { queueName: 'Desktop Support' } }],
        displayInCatalog: true,
        form: {
          title: 'MacBook Request',
          fields: [{ id: 'reason', label: 'Reason', type: 'text', required: true }],
        },
        settings: { category: categoryId, catalogIcon: 'laptop', catalogImageId: upload.body.id },
      };
      const input = {
        name: definition.name,
        department: 'it',
        keywords: ['macbook'],
        action: 'route',
        queueName: 'Desktop Support',
        enabled: true,
        definition,
      };
      const workflow = await call(admin.cookie, '/helpdesk/workflows', 'POST', input, workspace);
      assert.equal(workflow.status, 201, JSON.stringify(workflow.body));
      const catalog = await call(
        admin.cookie,
        '/helpdesk/catalog?list=1&sort=Workflow',
        'GET',
        undefined,
        workspace,
      );
      assert.equal(catalog.body.rows[0].category, 'Equipment');
      assert.equal(catalog.body.rows[0].catalogImageId, upload.body.id);
      const related = await call(
        admin.cookie,
        `/helpdesk/data/tables/ref-catalog-category/records/${categoryId}/workflows?list=1&sort=Workflow`,
        'GET',
        undefined,
        workspace,
      );
      assert.equal(related.body.rows[0].id, workflow.body.id);
      const categoryOptions = await call(
        admin.cookie,
        '/helpdesk/data/tables/ref-catalog-category/options',
        'GET',
        undefined,
        workspace,
      );
      assert.ok(categoryOptions.body[0].href.endsWith(categoryId));
      const departmentId = new ObjectId().toHexString();
      const foreignDepartmentId = new ObjectId().toHexString();
      await db.collection('workforceReferences').insertMany([
        {
          _id: departmentId,
          ownerId: adminId,
          workspaceId: workspace,
          type: 'department',
          name: 'Research Operations',
        },
        {
          _id: foreignDepartmentId,
          ownerId: other.body.user.id,
          workspaceId: other.body.user.workspaceId,
          type: 'department',
          name: 'Foreign',
        },
      ]);
      const scopedInput = {
        ...input,
        department: 'general',
        definition: { ...definition, trigger: { departmentId, phrases: ['macbook'] } },
      };
      const scopedWorkflow = await call(
        admin.cookie,
        '/helpdesk/workflows',
        'POST',
        scopedInput,
        workspace,
      );
      assert.equal(scopedWorkflow.status, 201, JSON.stringify(scopedWorkflow.body));
      assert.equal(scopedWorkflow.body.definition.trigger.departmentId, departmentId);
      let scopedCatalog = await call(
        admin.cookie,
        '/helpdesk/catalog?list=1&sort=Workflow',
        'GET',
        undefined,
        workspace,
      );
      assert.equal(
        scopedCatalog.body.rows.some((item) => item.id === scopedWorkflow.body.id),
        false,
      );
      await db
        .collection('workforceProfiles')
        .updateOne(
          { ownerId: adminId, workspaceId: workspace, userId: adminId },
          { $set: { department: departmentId } },
          { upsert: true },
        );
      scopedCatalog = await call(
        admin.cookie,
        '/helpdesk/catalog?list=1&sort=Workflow',
        'GET',
        undefined,
        workspace,
      );
      assert.equal(
        scopedCatalog.body.rows.some((item) => item.id === scopedWorkflow.body.id),
        true,
      );
      const foreignDepartment = await call(
        admin.cookie,
        '/helpdesk/workflows',
        'POST',
        {
          ...scopedInput,
          definition: {
            ...scopedInput.definition,
            trigger: { departmentId: foreignDepartmentId, phrases: ['macbook'] },
          },
        },
        workspace,
      );
      assert.equal(foreignDepartment.status, 422);
      await db.collection('workforceReferences').deleteOne({ _id: departmentId });
      scopedCatalog = await call(
        admin.cookie,
        '/helpdesk/catalog?list=1&sort=Workflow',
        'GET',
        undefined,
        workspace,
      );
      assert.equal(
        scopedCatalog.body.rows.some((item) => item.id === scopedWorkflow.body.id),
        false,
      );
      const badCategory = await call(
        admin.cookie,
        '/helpdesk/workflows',
        'POST',
        { ...input, definition: { ...definition, settings: { category: 'missing-category' } } },
        workspace,
      );
      assert.equal(badCategory.status, 422);
      assert.equal(
        (await call(other.cookie, `/helpdesk/catalog-images/${upload.body.id}`)).status,
        404,
      );
      const schema = await call(
        admin.cookie,
        '/helpdesk/data/tables/ref-asset',
        'GET',
        undefined,
        workspace,
      );
      assert.ok(schema.body.protectedFields.includes('status'));
      const removal = await call(
        admin.cookie,
        '/helpdesk/data/tables/ref-asset',
        'PUT',
        {
          version: schema.body.version,
          confirmedRemovedFieldIds: ['status'],
          definition: {
            name: schema.body.name,
            description: schema.body.description,
            fields: schema.body.fields.filter((field) => field.id !== 'status'),
          },
        },
        workspace,
      );
      assert.equal(removal.status, 409);
      const custom = { id: 'team-code', label: 'Team Code', type: 'text', required: false };
      const add = await call(
        admin.cookie,
        '/helpdesk/data/tables/ref-asset',
        'PUT',
        {
          version: schema.body.version,
          definition: {
            name: schema.body.name,
            description: schema.body.description,
            fields: [...schema.body.fields, custom],
          },
        },
        workspace,
      );
      assert.equal(add.status, 200, JSON.stringify(add.body));
      const recent = await call(
        admin.cookie,
        '/helpdesk/recent-views',
        'POST',
        { href: `/workspace/${workspace}/workflows/${workflow.body.id}/edit` },
        workspace,
      );
      assert.equal(recent.status, 200, JSON.stringify(recent.body));
      assert.equal(recent.body.recorded, true);
      assert.equal(
        (await call(admin.cookie, '/helpdesk/recent-views', 'GET', undefined, workspace)).body[0]
          .title,
        'MacBook Request',
      );
      assert.equal((await call(other.cookie, '/helpdesk/recent-views')).body.length, 0);
      await db
        .collection('workforceProfiles')
        .updateOne(
          { ownerId: adminId, workspaceId: workspace, userId: adminId },
          { $set: { title: 'IT Director' } },
          { upsert: true },
        );
      const context = await chatUserContext(store, {
        ownerId: adminId,
        providerOwnerId: adminId,
        workspaceId: workspace,
        helpdeskPurpose: 'workflow',
      });
      assert.equal(context.id, adminId);
      assert.equal(context.profile.title, 'IT Director');
      assert.equal(
        await chatUserContext(store, {
          ownerId: other.body.user.id,
          providerOwnerId: adminId,
          workspaceId: workspace,
          helpdeskPurpose: 'support',
        }),
        null,
      );
      const disabled = await call(
        admin.cookie,
        `/helpdesk/groups/${group.body.id}`,
        'PUT',
        {
          name: group.body.name,
          description: group.body.description,
          routingInstructions: group.body.routingInstructions,
          userIds: [adminId],
          active: true,
          assignmentEnabled: false,
          approvalEnabled: false,
          version: group.body.version,
        },
        workspace,
      );
      assert.equal(disabled.status, 200, JSON.stringify(disabled.body));
      await assert.rejects(requireExistingQueues(store, actor, ['Desktop Support']), {
        status: 400,
      });
      assert.equal(
        (await workspaceGroups(store, actor)).find((record) => String(record._id) === group.body.id)
          .assignmentEnabled,
        false,
      );
      const manifest = await call(
        admin.cookie,
        '/helpdesk/channels/slack/manifest',
        'GET',
        undefined,
        workspace,
      );
      assert.equal(manifest.body.features.app_home.messages_tab_read_only_enabled, false);
      assert.equal(manifest.body.features.app_home.messages_tab_read_only, undefined);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await app.locals.close();
      await db.dropDatabase();
      await client.close();
    }
  },
);
