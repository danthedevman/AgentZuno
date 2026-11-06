import { demoRetentionPlan, retainDemoReferences } from '../../demo/demoReferences.js';
import {
  seedDemoConversation,
  prepareDemoMembership,
  seedDemoApproval,
} from '../../demo/demoConversations.js';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { readData } from '../../data/data.js';
import { defineWorkflow, toTypeScript } from '../../../sdk/workflows/index.js';
import { inspectWorkflowSource } from '../../workflows/workflowRuntime.js';
import { helpdeskScope, requireRole, deny } from '../../identity/helpdeskRoles.js';
import { recordId, collections, demoFilter } from '../../demo/demoMode.js';
export function createDemoModeController(store, service) {
  const scopeId = (user) => `${helpdeskScope(user).ownerId}:${user.workspaceId}`;
  async function settings(user) {
    const scope = helpdeskScope(user);
    const saved = await store
      .collection('helpdeskDemoSettings')
      .findOne({ _id: scopeId(user), ...scope });
    const counts = {};
    for (const name of collections)
      counts[name] = await store.collection(name).countDocuments(demoFilter(scope, name));
    return {
      loaded: Object.values(counts).some(Boolean),
      industry: saved?.industry || 'tech',
      state: saved?.state || 'ready',
      counts,
      industries: Object.entries((await readData('demo-industries.json')).industries).map(
        ([value, item]) => ({ value, label: item.name }),
      ),
    };
  }
  const getDemoSettings = async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    response.json(await settings(request.helpdeskUser));
  };
  const getDemoRemovalPreview = async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    const retained = await demoRetentionPlan(store, request.helpdeskUser);
    response.json({
      retained: retained.map(({ collection, record }) => ({
        type: collection,
        name: record.name || record.title || record.email || String(record._id),
      })),
    });
  };
  const putDemoSettings = async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const input = request.body;
    if (
      !input ||
      Object.keys(input).some(
        (key) => !['action', 'industry', 'confirmed', 'enableApprovals'].includes(key),
      ) ||
      !['load', 'remove'].includes(input.action) ||
      (input.enableApprovals !== undefined && typeof input.enableApprovals !== 'boolean')
    )
      deny('Choose Load Demo Data or Remove Demo Data.', 400);
    const config = await readData('demo-industries.json');
    if (!Object.hasOwn(config.industries, input.industry)) deny('Choose a demo industry.', 400);
    if (input.action === 'remove' && input.confirmed !== true)
      deny('Confirm removal of demo records.', 400);
    const scope = helpdeskScope(user),
      id = scopeId(user),
      token = randomUUID();
    await store
      .collection('helpdeskDemoSettings')
      .updateOne(
        { _id: id, ...scope },
        { $setOnInsert: { ...scope, state: 'ready' } },
        { upsert: true },
      );
    const claim = await store.collection('helpdeskDemoSettings').findOneAndUpdate(
      {
        _id: id,
        ...scope,
        $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: new Date() } }],
      },
      {
        $set: {
          leaseToken: token,
          leaseUntil: new Date(Date.now() + 300000),
          state: input.action === 'load' ? 'loading' : 'removing',
        },
      },
      { returnDocument: 'after' },
    );
    if (!claim) deny('A demo operation is already in progress.', 409);
    const dataset = `demo-v${config.version}-${input.industry}`;
    const tag = { demo: true, demoDatasetId: dataset, demoIndustry: input.industry };
    async function put(name, key, values, stringId = false) {
      const hex = recordId(scope, input.industry, key);
      const _id = stringId ? hex : new ObjectId(hex);
      const existing = await store.collection(name).findOne({ _id });
      if (
        existing?.retainedFromDemo?.datasetId === dataset &&
        existing.ownerId === scope.ownerId &&
        existing.workspaceId === scope.workspaceId
      )
        return hex;
      if (
        existing &&
        (existing.ownerId !== scope.ownerId ||
          existing.workspaceId !== scope.workspaceId ||
          existing.demoDatasetId !== dataset)
      )
        deny('Demo record identity conflict.', 409);
      await store
        .collection(name)
        .updateOne(
          { _id, ...scope },
          { $setOnInsert: { ...scope, ...tag, ...values, _id } },
          { upsert: true },
        );
      return hex;
    }
    try {
      const previous = await settings(user);
      if (input.action === 'load') {
        if (previous.loaded && claim.industry && claim.industry !== input.industry)
          deny('Remove the current demo dataset before loading another industry.', 409);
        const examples = config.industries[input.industry],
          now = new Date();
        const groupName = `Demo ${examples.name} Support`;
        await prepareDemoMembership(store, scope, user, tag, groupName, input.enableApprovals);
        await put('approvalGroups', 'group', {
          name: groupName,
          description: 'Demo assignment group',
          active: true,
          assignmentEnabled: true,
          approvalEnabled: false,
          unifiedVersion: 1,
          userIds: [user.id],
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        const category = await put(
          'workforceReferences',
          'category',
          {
            type: 'catalog-category',
            name: `Demo ${examples.name}`,
            description: 'Demo catalog items',
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
          true,
        );
        const base = await put('records', 'base', {
          type: 'knowledge-base',
          name: `Demo ${examples.name} Knowledge`,
          description: 'Fictional guidance for exploring AgentZuno',
          icon: 'layers',
          updatedAt: now.toISOString(),
        });
        const topic = await put('records', 'topic', {
          type: 'topic',
          name: `Demo ${examples.name} Getting Started`,
          description: 'Fictional employee guidance',
          base,
          articleIds: [],
          updatedAt: now.toISOString(),
        });
        await put('knowledgePermissions', 'base-policy', {
          kind: 'base',
          resourceId: base,
          mode: 'workspace',
          userIds: [],
          roles: [],
          version: 1,
          updatedAt: now,
        });
        for (const [index, item] of examples.knowledge.entries())
          await put('articles', `article-${index}`, {
            title: `Demo: ${item.name}`,
            body: `<h2>${item.name}</h2><p>This is fictional demo guidance for the ${examples.name} workspace.</p>${(item.guidance || []).map((step) => `<p>${step}</p>`).join('')}`,
            summary: `Demo guidance: ${item.name}`,
            status: 'Published',
            base,
            topicIds: [topic],
            attachmentIds: [],
            sections: [],
            semanticGeneration: randomUUID(),
            semanticStatus: 'Pending',
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          });
        for (const [index, item] of examples.assets.entries())
          await put(
            'workforceReferences',
            `asset-${index}`,
            {
              type: 'asset',
              name: `Demo: ${item.name}`,
              description: item.details,
              customValues: { status: item.status, 'asset-tag': `DEMO-${index + 1}` },
              version: 1,
              createdAt: now,
              updatedAt: now,
            },
            true,
          );
        for (const [index, item] of examples.workflows.entries()) {
          const definition = defineWorkflow({
            version: 1,
            name: `Demo: ${item.name}`,
            trigger: {
              department: 'general',
              phrases: [item.name.toLowerCase(), `demo ${item.name.toLowerCase()}`],
            },
            displayInCatalog: true,
            settings: {
              category,
              description: `${item.details}. Demo data`,
              catalogIcon: 'catalog',
            },
            form: item.form || {
              title: item.name,
              fields: [
                { id: 'details', label: 'Details', type: 'textarea', required: true },
                {
                  id: 'additional-details',
                  label: 'Additional Details',
                  type: 'text',
                  required: false,
                },
              ],
            },
            steps: [{ id: 'route-request', action: 'route', params: { queueName: groupName } }],
          });
          const source = toTypeScript(definition);
          await inspectWorkflowSource(source);
          const value = {
            definition,
            source,
            name: definition.name,
            department: 'general',
            keywords: definition.trigger.phrases,
            action: 'route',
            queueName: groupName,
            enabled: true,
          };
          const workflow = await put('helpdeskWorkflows', `workflow-${index}`, {
            ...value,
            version: 1,
            publishedConfig: value,
            publishedRevision: 1,
            createdAt: now,
            updatedAt: now,
          });
          await put('workflowRevisions', `revision-${index}`, {
            workflowId: workflow,
            revision: 1,
            config: value,
            createdAt: now,
          });
          const savedWorkflow = await store
            .collection('helpdeskWorkflows')
            .findOne({ ...scope, _id: new ObjectId(workflow) });
          await seedDemoConversation(
            store,
            scope,
            user,
            tag,
            workflow,
            savedWorkflow.publishedConfig || value,
            `Build a ${item.name} workflow with a request form and optional additional details. Route submitted requests to ${groupName} and display the item in the catalog.`,
          );
        }
        for (const [index, item] of examples.requests.entries()) {
          const requestId = recordId(scope, input.industry, `request-${index}`);
          let record = await store
            .collection('helpdeskRequests')
            .findOne({ ...scope, demoDatasetId: dataset, demoSeedKey: requestId });
          if (!record) {
            // The request and its originating chat receive their tag before persistence.
            const result = await service.create(
              user,
              {
                requestId: `${requestId.slice(0, 8)}-${requestId.slice(8, 12)}-4000-8000-${requestId.slice(12)}`,
                title: `Demo: ${item.name}`,
                text: item.details,
              },
              {
                workflowRouting: { queueName: groupName },
                demoTag: { ...tag, demoSeedKey: requestId },
              },
            );
            record = await store
              .collection('helpdeskRequests')
              .findOne({ ...scope, _id: new ObjectId(result.id) });
            await store.collection('helpdeskRequests').updateOne(
              { ...scope, _id: record._id },
              {
                $set: {
                  assignedToId: user.id,
                  assignedToName: user.name || user.email,
                  status:
                    item.status === 'Resolved'
                      ? 'resolved'
                      : item.status === 'Awaiting Response'
                        ? 'waiting-for-employee'
                        : 'open',
                },
              },
            );
          }
        }
        await seedDemoApproval(store, service, scope, user, tag, groupName, category, put);
        for (const request of await store
          .collection('helpdeskRequests')
          .find({ ...scope, demoDatasetId: dataset })
          .toArray()) {
          const id = recordId(scope, input.industry, `task-${request._id}`);
          await put('helpdeskTasks', id, {
            ...scope,
            ...tag,
            requestId: String(request._id),
            title: `Prepare ${request.title.replace(/^Demo: /, '')}`,
            description:
              'Confirm the requested details and coordinate fulfillment with the support team.',
            status: request.status === 'resolved' ? 'closed' : 'open',
            queueName: groupName,
            createdBy: user.id,
            version: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
            events: [{ type: 'created', actorId: user.id, at: new Date() }],
          });
        }
      } else {
        const retained = await demoRetentionPlan(store, user);
        const demoRequests = await store
          .collection('helpdeskRequests')
          .find({ ...scope, demoDatasetId: { $exists: true } }, { projection: { _id: 1 } })
          .toArray();
        const ids = demoRequests.map((row) => String(row._id));
        if (
          await store.collection('workflowRuns').findOne({
            ...scope,
            requestId: { $in: ids },
            status: { $in: ['running', 'delivery-unknown'] },
          })
        )
          deny(
            'Wait for active demo runs to finish or review uncertain delivery before removal.',
            409,
          );
        await retainDemoReferences(store, user, retained);
        const demoGroups = await store
          .collection('approvalGroups')
          .find({ ...scope, demoDatasetId: { $exists: true } }, { projection: { name: 1 } })
          .toArray();
        // Preserve run and governance history; authoritative records are removed.
        await store.collection('workflowRuns').updateMany(
          { ...scope, requestId: { $in: ids }, status: { $nin: ['complete', 'failed'] } },
          {
            $set: {
              status: 'failed',
              error: 'Demo data removed by an administrator.',
              updatedAt: new Date(),
            },
          },
        );
        for (const article of await store
          .collection('articles')
          .find({ ...scope, demoDatasetId: { $exists: true } }, { projection: { _id: 1 } })
          .toArray())
          await store.collection('authoredSemanticRetirements').updateOne(
            { _id: String(article._id), ...scope },
            {
              $set: {
                ...scope,
                status: 'Pending',
                generation: randomUUID(),
                updatedAt: new Date(),
              },
            },
            { upsert: true },
          );
        await store
          .collection('requestAttachments')
          .deleteMany({ ...scope, requestId: { $in: ids } });
        for (const adjustment of await store
          .collection('demoMembershipAdjustments')
          .find({ ...scope, demoDatasetId: { $exists: true } })
          .toArray()) {
          if (adjustment.enabledApproval)
            await store.collection('helpdeskMembers').updateOne(
              {
                ...scope,
                userId: adjustment.userId,
                version: adjustment.grantVersion,
                canApprove: true,
              },
              { $set: { canApprove: false, updatedAt: new Date() }, $inc: { version: 1 } },
            );
        }
        await store.collection('helpdeskMembers').updateMany(
          { ...scope, queues: { $in: demoGroups.map((group) => group.name) } },
          {
            $pull: { queues: { $in: demoGroups.map((group) => group.name) } },
            $inc: { version: 1 },
            $set: { updatedAt: new Date() },
          },
        );
        for (const name of collections)
          await store.collection(name).deleteMany(demoFilter(scope, name));
      }
      await store.collection('helpdeskDemoSettings').updateOne(
        { _id: id, ...scope, leaseToken: token },
        {
          $set: {
            industry: input.industry,
            enabled: false,
            state: 'ready',
            updatedAt: new Date(),
          },
          $unset: { leaseToken: '', leaseUntil: '' },
        },
      );
      response.json(await settings(user));
    } catch (error) {
      await store.collection('helpdeskDemoSettings').updateOne(
        { _id: id, ...scope, leaseToken: token },
        {
          $set: { state: 'incomplete', industry: input.industry },
          $unset: { leaseToken: '', leaseUntil: '' },
        },
      );
      throw error;
    }
  };
  return { getDemoSettings, getDemoRemovalPreview, putDemoSettings };
}
