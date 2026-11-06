import { queryString } from '../shared/queryValues.js';
import { ObjectId } from 'mongodb';
import { randomUUID, createHash } from 'node:crypto';
import { createWorkflowExecution } from '../workflows/workflowExecution.js';
import { defineWorkflow, toTypeScript } from '../../sdk/workflows/index.js';
import { inspectWorkflowSource } from '../workflows/workflowRuntime.js';
import { deny } from '../identity/helpdeskRoles.js';
const idFor = (scope, dataset, key) =>
  createHash('sha256')
    .update(JSON.stringify([scope, dataset, key]))
    .digest('hex')
    .slice(0, 24);
export async function seedDemoConversation(store, scope, user, tag, workflowId, config, prompt) {
  const id = idFor(scope, tag.demoDatasetId, `chat:${workflowId}:${user.id}`),
    now = new Date();
  await store.collection('chats').updateOne(
    {
      _id: new ObjectId(id),
      ownerId: queryString(user.id),
      workspaceId: queryString(scope.workspaceId),
    },
    {
      $setOnInsert: {
        ...tag,
        ownerId: queryString(user.id),
        providerOwnerId: scope.ownerId,
        workspaceId: queryString(scope.workspaceId),
        requestId: randomUUID(),
        assistantType: 'admin',
        helpdeskPurpose: 'workflow',
        workflowDraft: config.definition,
        workflowSource: config.source,
        title: prompt.slice(0, 100),
        status: 'complete',
        phase: 'complete',
        responseId: randomUUID(),
        messages: [
          { id: randomUUID(), role: 'user', text: prompt, status: 'complete', createdAt: now },
          {
            id: randomUUID(),
            role: 'assistant',
            text: `The request form and internal routing are ready to review.\n\n\`\`\`typescript\n${config.source}\n\`\`\``,
            status: 'complete',
            createdAt: now,
          },
        ],
        messageCount: 2,
        progressEvents: [],
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
  await store.collection('helpdeskWorkflowConversations').updateOne(
    { ...scope, actorId: user.id, workflowId, chatId: id },
    {
      $setOnInsert: {
        ...scope,
        ...tag,
        actorId: user.id,
        workflowId,
        chatId: id,
        createdAt: now,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
}
export async function prepareDemoMembership(store, scope, user, tag, groupName, enableApprovals) {
  const filter = { ...scope, userId: queryString(user.id) };
  const member = await store.collection('helpdeskMembers').findOne(filter);
  if (!member) deny('Reload your membership before loading demo data.', 409);
  if (!member.canApprove && enableApprovals !== true)
    deny('Confirm enabling approval permission to load actionable demo approvals.', 400);
  const key = { ...scope, ...tag, userId: queryString(user.id) };
  await store.collection('demoMembershipAdjustments').updateOne(
    { ...scope, userId: queryString(user.id), demoDatasetId: tag.demoDatasetId },
    {
      $setOnInsert: {
        ...key,
        enabledApproval: !member.canApprove,
        previousCanApprove: member.canApprove === true,
        grantVersion: member.version + 1,
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
  if (!member.queues.includes(groupName) || !member.canApprove)
    await store.collection('helpdeskMembers').updateOne(
      { ...filter, version: member.version },
      {
        $addToSet: { queues: groupName },
        $set: { canApprove: true, updatedAt: new Date() },
        $inc: { version: 1 },
      },
    );
}
export async function seedDemoApproval(store, service, scope, user, tag, groupName, put) {
  const now = new Date(),
    employeeId = idFor(scope, tag.demoDatasetId, 'employee');
  await store.collection('users').updateOne(
    {
      id: employeeId,
      demoWorkspaceId: queryString(scope.workspaceId),
      ownerId: queryString(scope.ownerId),
    },
    {
      $setOnInsert: {
        _id: new ObjectId(employeeId),
        id: employeeId,
        ownerId: queryString(scope.ownerId),
        demoWorkspaceId: queryString(scope.workspaceId),
        workspaceId: idFor(scope, tag.demoDatasetId, 'employee-private-workspace'),
        ...tag,
        name: 'Demo Employee',
        email: `demo-${employeeId}@identity.agentzuno.invalid`,
        identityOnly: true,
        createdAt: now,
      },
    },
    { upsert: true },
  );
  await put('helpdeskMembers', 'employee-membership', {
    userId: employeeId,
    email: `demo-${employeeId}@identity.agentzuno.invalid`,
    role: 'user',
    active: true,
    canApprove: false,
    queues: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  const definition = defineWorkflow({
    version: 1,
    name: 'Demo: Equipment Approval',
    trigger: { department: 'general', phrases: ['demo equipment approval'] },
    settings: {
      description: 'Demo equipment request with an approval and internal assignment',
    },
    form: {
      title: 'Demo Equipment Approval',
      fields: [{ id: 'details', label: 'Details', type: 'textarea', required: true }],
    },
    steps: [
      {
        id: 'approve-equipment',
        action: 'approval',
        params: {
          target: 'user',
          userId: queryString(user.id),
          reason: 'Review this fictional equipment request',
        },
        requireRejectionComment: true,
      },
      { id: 'route-request', action: 'route', params: { queueName: groupName } },
    ],
  });
  const source = toTypeScript(definition);
  await inspectWorkflowSource(source);
  const config = {
    name: definition.name,
    definition,
    source,
    department: 'general',
    keywords: definition.trigger.phrases,
    action: 'route',
    queueName: groupName,
    enabled: true,
  };
  const workflowId = await put('helpdeskWorkflows', 'approval-workflow', {
    ...config,
    version: 1,
    publishedConfig: config,
    publishedRevision: 1,
    createdAt: now,
    updatedAt: now,
  });
  await put('workflowRevisions', 'approval-revision', {
    workflowId,
    revision: 1,
    config,
    createdAt: now,
  });
  await seedDemoConversation(
    store,
    scope,
    user,
    tag,
    workflowId,
    config,
    `Build a demo equipment request form. Ask me to approve it with a required rejection comment, then route it to ${groupName}.`,
  );
  const requestKey = idFor(scope, tag.demoDatasetId, 'approval-request');
  let record = await store
    .collection('helpdeskRequests')
    .findOne({ ...scope, demoSeedKey: requestKey });
  if (!record) {
    const actor = {
      id: employeeId,
      name: 'Demo Employee',
      email: `demo-${employeeId}@identity.agentzuno.invalid`,
      workspaceId: queryString(scope.workspaceId),
      helpdeskOwnerId: scope.ownerId,
      role: 'user',
      queues: [],
      canApprove: false,
    };
    const result = await service.create(
      actor,
      {
        requestId: `${requestKey.slice(0, 8)}-${requestKey.slice(8, 12)}-4000-8000-${requestKey.slice(12)}`,
        title: 'Demo: Equipment Purchase Approval',
        text: 'Please review this fictional request for a replacement work device.',
      },
      {
        demoTag: { ...tag, demoSeedKey: requestKey },
        workflowRouting: {
          workflowId,
          workflowVersion: 1,
          workflowName: definition.name,
          queueName: groupName,
        },
        formSubmission: {
          title: definition.form.title,
          workflowId,
          workflowVersion: 1,
          answers: [
            {
              id: 'details',
              label: 'Details',
              value: 'Replacement device for a fictional employee',
              type: 'textarea',
            },
          ],
          submittedAt: now,
        },
      },
    );
    record = await store
      .collection('helpdeskRequests')
      .findOne({ ...scope, _id: new ObjectId(result.id) });
  }
  const execution = createWorkflowExecution(store),
    runId = await execution.ensureRun(record);
  const run = await store.collection('workflowRuns').findOne({ _id: runId });
  if (run?.status === 'queued') await execution.process(runId);
}
