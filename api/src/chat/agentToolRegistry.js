import { createKnowledgeTopics, knowledgeStructure } from '../knowledge/knowledgeTopics.js';
import { queryString } from '../shared/queryValues.js';
import { prepareChannelRequestDraft } from '../channels/channelRequestForms.js';
import { createDataRecordOperations, dataRecordValues } from '../data/dataRecordOperations.js';
import { auditOperation } from '../audit/audit.js';
import { createAdminGroup } from '../identity/adminGroupActions.js';
import { validateArticleDraft, articleCandidate } from '../knowledge/articleDesigner.js';
import { createAdminData, defineDataTable } from '../data/adminData.js';
import { inspectWorkflowSource } from '../workflows/workflowRuntime.js';
import { requireExistingQueues } from '../identity/helpdeskQueues.js';
import { validateWorkflowReferences } from '../workflows/workflowReferences.js';
import {
  allowedRequestActions,
  ownChatRequest,
  validateRequestAction,
} from '../requests/requestChatActions.js';
import { helpdeskScope, deny } from '../identity/helpdeskRoles.js';
import { resolveChatActor } from './chatAuthorization.js';
import { workspaceGroups } from '../identity/groups.js';

const object = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const text = (maxLength) => ({ type: 'string', maxLength });
const nullable = (value) => ({ anyOf: [value, { type: 'null' }] });
const definition = (name, description, parameters, kind, execute) => ({
  name,
  description,
  parameters,
  kind,
  execute,
});
const empty = object({});
const tools = [
  definition(
    'getMyAccess',
    'Read the current user’s tracked application access and pending access requests before suggesting duplicate access. This does not grant or revoke access.',
    empty,
    'channel-request',
    async ({ store, actor }) => ({
      access: (
        await store
          .collection('userAccess')
          .find({ ...helpdeskScope(actor), userId: queryString(actor.id, 80) })
          .sort({ updatedAt: -1 })
          .limit(20)
          .toArray()
      ).map((row) => ({
        application: row.applicationName,
        accessLevel: row.accessLevel,
        status: row.status,
        requestNumber: row.requestNumber || null,
        href: `/workspace/${actor.workspaceId}/access/${row._id}`,
      })),
    }),
  ),
  definition(
    'getMyRequests',
    'Read the current user’s own recent submitted requests and verified statuses. Use this for status questions; never claim a new request was submitted merely from a message.',
    empty,
    'channel-request',
    async ({ store, actor }) => ({
      requests: (
        await store
          .collection('helpdeskRequests')
          .find({ ...helpdeskScope(actor), requesterId: queryString(actor.id, 80) })
          .sort({ updatedAt: -1 })
          .limit(10)
          .toArray()
      ).map((row) => ({
        number: row.number,
        title: row.title,
        status: row.status,
        href: `${process.env.APP_ORIGIN || 'http://localhost:3000'}/workspace/${actor.workspaceId}/chat/${row.chatId}?request=${row._id}`,
      })),
    }),
  ),
  definition(
    'listKnowledgeStructure',
    'List current knowledge bases and knowledge topics. Topics are knowledge records, separate from catalog categories.',
    empty,
    'knowledge',
    async ({ store, actor }) => {
      const current = await knowledgeStructure(store, actor);
      return {
        bases: current.knowledgeBases.map(({ id, name }) => ({ id, name })),
        topics: current.topics.map(({ id, name, knowledgeBaseId, parentTopicId }) => ({
          id,
          name,
          knowledgeBaseId: knowledgeBaseId || null,
          parentTopicId: parentTopicId || null,
        })),
      };
    },
  ),
  definition(
    'createKnowledgeTopic',
    'Create an explicitly requested knowledge topic, optionally nested under parentTopicId (maximum three topic levels), using the same service as Knowledge Topics. Use an existing base ID or null for a general topic. Return its saved link; never create a catalog category instead.',
    object(
      {
        name: text(100),
        description: text(1000),
        knowledgeBaseId: nullable(text(80)),
        parentTopicId: nullable(text(80)),
      },
      ['name', 'description', 'knowledgeBaseId'],
    ),
    'knowledge',
    async ({ store, actor, chat }, input) => {
      const current = await knowledgeStructure(store, actor);
      if (
        input.knowledgeBaseId !== null &&
        !current.knowledgeBases.some((base) => base.id === input.knowledgeBaseId)
      )
        deny('Choose an existing knowledge base.', 400);
      const existing = current.topics.find(
        (topic) =>
          topic.name.toLowerCase() === String(input.name).toLowerCase() &&
          (topic.knowledgeBaseId || null) === input.knowledgeBaseId &&
          (topic.parentTopicId || null) === (input.parentTopicId || null),
      );
      const topic =
        existing ||
        (await createKnowledgeTopics(store)(actor, {
          name: input.name,
          description: input.description,
          articleIds: [],
          parentTopicId: input.parentTopicId || '',
          ...(input.knowledgeBaseId ? { knowledgeBaseId: input.knowledgeBaseId } : {}),
        }));
      return {
        id: topic.id,
        name: topic.name,
        status: 'saved',
        href: `/workspace/${actor.workspaceId}/knowledge/topics/${topic.id}`,
        ...(chat.helpdeskPurpose === 'article'
          ? {
              proposal: {
                kind: 'articleMetadata',
                topicIds: [...new Set([...(chat.articleDraft?.topicIds || []), topic.id])],
                knowledgeBaseId:
                  input.knowledgeBaseId || chat.articleDraft?.knowledgeBaseId || null,
              },
            }
          : {}),
      };
    },
  ),
  definition(
    'setArticleTopics',
    'Select existing knowledge topics for the article draft. This changes only the proposed form selection; article persistence still requires preview approval.',
    object({
      knowledgeBaseId: text(80),
      topicIds: { type: 'array', minItems: 1, maxItems: 20, items: text(24) },
    }),
    'article',
    async ({ store, actor }, input) => {
      const current = await knowledgeStructure(store, actor);
      if (
        !current.knowledgeBases.some((base) => base.id === input.knowledgeBaseId) ||
        !Array.isArray(input.topicIds) ||
        input.topicIds.some(
          (id) =>
            !current.topics.some(
              (topic) =>
                topic.id === id &&
                (!topic.knowledgeBaseId || topic.knowledgeBaseId === input.knowledgeBaseId),
            ),
        )
      )
        deny('Choose a valid base and its topics.', 400);
      return {
        proposal: {
          kind: 'articleMetadata',
          knowledgeBaseId: input.knowledgeBaseId,
          topicIds: [...new Set(input.topicIds)],
        },
        message: 'Article topics selected in the draft. Saving still requires approval.',
      };
    },
  ),
  definition(
    'prepareChannelRequest',
    'Collect request answers from conversation using published field IDs. Merge answers supplied so far and ask only for missing required fields. This prepares a review and Submit Request button; never claim submission before the person confirms.',
    object({
      workflowId: nullable(text(24)),
      answers: {
        type: 'array',
        maxItems: 20,
        items: object({ fieldId: text(40), value: { anyOf: [text(2000), { type: 'boolean' }] } }),
      },
    }),
    'channel-request',
    async ({ store, chat, actor }, input) => prepareChannelRequestDraft(store, chat, actor, input),
  ),
  definition(
    'listAvailableTools',
    'List the tools currently permitted for this agent, user, and conversation.',
    empty,
    'read',
    async (context) => ({
      tools: (await availableTools(context)).map(({ name, description }) => ({
        name,
        description,
      })),
    }),
  ),
  definition(
    'getCurrentUser',
    'Read the signed-in user identity and effective role. This never changes permissions.',
    empty,
    'read',
    async ({ store, actor }) => {
      const account = await store.collection('users').findOne({ id: actor.id });
      return {
        id: actor.id,
        name: account?.name || '',
        email: account?.displayEmail || account?.email || '',
        role: actor.role,
        workspaceId: actor.workspaceId,
      };
    },
  ),
  definition(
    'listGroups',
    'List current groups available for assignment and approval; use saved IDs and names.',
    empty,
    'admin',
    async ({ store, actor }) => ({
      groups: (await workspaceGroups(store, actor))
        .map(({ _id, name, active, assignmentEnabled, approvalEnabled }) => ({
          id: String(_id),
          name,
          active,
          assignmentEnabled,
          approvalEnabled,
        }))
        .slice(0, 200),
    }),
  ),
  definition(
    'listReferenceTables',
    'List existing data tables for reference fields. Never invent table IDs.',
    empty,
    'admin',
    async ({ store, actor }) => ({
      tables: (await createAdminData(store).tables(actor))
        .map(({ id, name }) => ({ id, name }))
        .slice(0, 200),
    }),
  ),
  definition(
    'getDataTable',
    'Read a table schema before selecting field IDs for a data operation or workflow grant.',
    object({ tableId: text(80) }),
    'admin',
    async ({ store, actor }, input) => createAdminData(store).table(actor, input.tableId),
  ),
  definition(
    'dataRecord',
    'Read, create, update, or propose deletion of a record in an authorized Data Table. Use exact table/record/field IDs and the current version. Deletion returns a human review link; this tool cannot confirm deletion. Managed system records use dedicated services.',
    object({
      operation: { type: 'string', enum: ['read', 'create', 'update', 'delete'] },
      tableId: text(80),
      recordId: nullable(text(24)),
      version: nullable({ type: 'integer', minimum: 0 }),
      fields: {
        type: 'array',
        maxItems: 20,
        items: object({
          fieldId: text(40),
          value: {
            anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'number' }, { type: 'boolean' }],
          },
        }),
      },
    }),
    'admin',
    async ({ store, actor, chat, call }, input) => {
      const service = createDataRecordOperations(store),
        key = `agent:${chat._id}:${chat.responseId}:${call.id}`;
      if (input.operation === 'read')
        return {
          action: 'dataRecord',
          record: await service.read(actor, input.tableId, input.recordId),
        };
      if (input.operation === 'delete')
        return {
          action: 'dataRecord',
          ...(await service.prepareDelete(
            actor,
            input.tableId,
            input.recordId,
            input.version,
            key,
          )),
        };
      const result = await service.mutate(
        actor,
        input.tableId,
        input.operation,
        input.recordId,
        dataRecordValues(input.fields),
        input.version,
        key,
      );
      return { action: 'dataRecord', status: 'saved', ...result };
    },
  ),
  definition(
    'createGroup',
    'Create a requested group or return its saved record. Assignment and approval default to true unless explicitly requested otherwise. No members are added implicitly.',
    object({
      name: text(80),
      description: text(1000),
      routingInstructions: text(2000),
      assignmentEnabled: { type: 'boolean' },
      approvalEnabled: { type: 'boolean' },
    }),
    'workflow',
    async ({ store, chat }, input) => createAdminGroup(store, chat, input),
  ),
  definition(
    'proposeWorkflow',
    'Propose complete executable workflow TypeScript for the visual/form/code editor. Use this tool for workflow changes, never a code block in the response. The draft is separate from explicit publication.',
    object({ source: text(40000) }),
    'workflow',
    async ({ store, actor }, input) => {
      if (typeof input.source !== 'string' || input.source.length > 40000)
        deny('Invalid workflow source.', 400);
      const definition = await inspectWorkflowSource(input.source);
      await requireExistingQueues(
        store,
        actor,
        definition.steps
          .filter((step) => ['route', 'handoff', 'task.create'].includes(step.action))
          .map((step) => step.params.queueName),
      );
      await validateWorkflowReferences(store, actor, definition);
      return {
        proposal: { kind: 'workflow', source: input.source, definition },
        message: 'Workflow draft validated for review; it has not been published.',
      };
    },
  ),
  definition(
    'proposeArticle',
    'Propose an article title and sanitized HTML body for a human preview. The user must explicitly approve before saving. Do not output a JSON block.',
    object({ title: text(160), body: text(200000) }),
    'article',
    async (_, input) => {
      const value = articleCandidate(validateArticleDraft(input));
      if (!value) deny('Invalid article proposal.', 400);
      return {
        proposal: { kind: 'article', ...value },
        message: 'Article preview ready. Explicit approval is required before saving.',
      };
    },
  ),
  definition(
    'proposeDataTable',
    'Propose the complete table definition for review and Save. Use only existing reference table IDs; no records or fields are saved by this tool.',
    object({
      name: text(80),
      description: text(1000),
      fields: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: object({
          id: text(40),
          label: text(80),
          type: {
            type: 'string',
            enum: ['text', 'number', 'boolean', 'date', 'email', 'reference'],
          },
          required: { type: 'boolean' },
          referenceTable: nullable(text(80)),
        }),
      },
    }),
    'data',
    async ({ store, actor }, input) => {
      if (
        !Array.isArray(input.fields) ||
        input.fields.some((field) => !field || typeof field !== 'object' || Array.isArray(field))
      )
        deny('Invalid data fields.', 400);
      const value = defineDataTable({
        ...input,
        fields: input.fields.map((field) => {
          const { referenceTable, ...rest } = field;
          return referenceTable === null ? rest : field;
        }),
      });
      for (const field of value.fields.filter((field) => field.type === 'reference'))
        if (field.referenceTable !== 'users')
          await createAdminData(store).table(actor, field.referenceTable);
      return {
        proposal: { kind: 'dataTable', definition: value },
        message: 'Table proposal ready for review and Save.',
      };
    },
  ),
  definition(
    'proposeRequestAction',
    'Prepare an explicitly requested comment, work note, assignment, update, or task action for human confirmation. This tool never executes the proposed mutation.',
    object({
      action: {
        type: 'string',
        enum: ['comment', 'work-note', 'assign-self', 'update', 'create-task', 'close-task'],
      },
      text: nullable(text(7000)),
      title: nullable(text(160)),
      description: nullable(text(7000)),
      taskId: nullable(text(80)),
      taskVersion: nullable({ type: 'integer', minimum: 1 }),
      status: nullable({
        type: 'string',
        enum: ['open', 'waiting-for-employee', 'escalated', 'resolved'],
      }),
      priority: nullable({ type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }),
    }),
    'request',
    async ({ store, actor, chat }, input) => {
      const request = await ownChatRequest(store, actor, chat);
      if (!request) deny('Request not found.', 404);
      const value = validateRequestAction(
        actor,
        request,
        Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null)),
      );
      return {
        proposal: {
          kind: 'requestAction',
          value: {
            ...value,
            requestId: String(request._id),
            number: request.number,
            version: request.version,
            state: 'pending',
          },
        },
        message: 'Request action prepared for explicit confirmation.',
      };
    },
  ),
];
async function availableTools(context) {
  const { chat, actor } = context;
  const admin = actor.role === 'admin' && chat.assistantType === 'admin';
  let canRequest = false;
  if (
    chat.assistantType === 'support' &&
    chat.helpdeskPurpose === 'support' &&
    chat.helpdeskRequestId
  ) {
    const request = await ownChatRequest(context.store, actor, chat);
    canRequest = !!request && allowedRequestActions(actor, request).length > 0;
  }
  return tools.filter(
    (tool) =>
      tool.kind === 'read' ||
      (admin && tool.kind === 'knowledge') ||
      (tool.kind === 'channel-request' &&
        chat.assistantType === 'support' &&
        ['slack-support', 'teams-support'].includes(chat.helpdeskPurpose) &&
        actor.role !== 'read-only' &&
        (chat.helpdeskPurpose !== 'slack-support' || chat.channelUserId)) ||
      (admin && tool.kind === 'admin') ||
      (admin && tool.kind === 'article' && chat.helpdeskPurpose === 'article') ||
      (admin && tool.kind === 'data' && chat.dataDesigner) ||
      (admin &&
        tool.kind === 'workflow' &&
        chat.helpdeskPurpose === 'workflow' &&
        !chat.dataDesigner) ||
      (tool.kind === 'request' && canRequest),
  );
}
export async function agentTools(store, chat) {
  if (
    chat.helpdeskPurpose === 'email-support' ||
    (chat.helpdeskPurpose === 'slack-support' && !chat.channelUserId)
  )
    return [];
  const actor = await resolveChatActor(store, chat);
  const definitions = await availableTools({ store, chat, actor });
  const request = definitions.some((tool) => tool.kind === 'request')
    ? await ownChatRequest(store, actor, chat)
    : null;
  return definitions.map(({ name, description, parameters, kind }) => ({
    name,
    description,
    parameters:
      kind === 'request'
        ? {
            ...parameters,
            properties: {
              ...parameters.properties,
              action: { type: 'string', enum: allowedRequestActions(actor, request) },
            },
          }
        : parameters,
  }));
}
export async function executeAgentTool(store, chat, call) {
  let actor, authorizationError;
  try {
    actor = await resolveChatActor(store, chat);
  } catch (error) {
    authorizationError = error;
  }
  const auditActor = actor
    ? { ...actor, ownerId: helpdeskScope(actor).ownerId }
    : { id: chat.ownerId, ownerId: chat.providerOwnerId, workspaceId: chat.workspaceId };
  const result = await auditOperation(
    store,
    auditActor,
    'agent-tool-' + (tools.some((tool) => tool.name === call.name) ? call.name : 'unknown'),
    '/agent-tools/' + (tools.some((tool) => tool.name === call.name) ? call.name : 'unknown'),
    async () => {
      if (authorizationError) throw authorizationError;
      const tool = (await availableTools({ store, chat, actor })).find(
        (tool) => tool.name === call.name,
      );
      if (!tool) deny('This agent is not permitted to use that tool.');
      const input = call.arguments;
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).some((key) => !Object.hasOwn(tool.parameters.properties, key)) ||
        tool.parameters.required.some((key) => !Object.hasOwn(input, key))
      )
        deny('Invalid tool arguments.', 400);
      return tool.execute({ store, chat, actor, call }, input);
    },
    {
      triggerType: chat.assistantType === 'admin' ? 'admin-chat' : 'support-chat',
      triggerLabel: 'Agent used an authorized typed tool',
      sourceChatId: String(chat._id),
      responseId: chat.responseId,
      toolCallId: call.id,
      toolName: tools.some((tool) => tool.name === call.name) ? call.name : 'unknown',
    },
  );
  // Do not echo complete code/article contents to a provider as a second copy.
  return result;
}
