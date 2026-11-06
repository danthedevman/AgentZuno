import { validateWorkflowReferences } from '../../workflows/workflowReferences.js';

import { validateWorkflowDepartment } from '../../workflows/workflowDepartments.js';

import { inspectWorkflowSource } from '../../workflows/workflowRuntime.js';
import { createWorkflowExecution } from '../../workflows/workflowExecution.js';

import { requireExistingQueues } from '../../identity/helpdeskQueues.js';

import { listResponse } from '../../shared/listQuery.js';
import { ObjectId } from 'mongodb';
import { readFile } from 'node:fs/promises';

import { requireRole } from '../../identity/helpdeskRoles.js';
import {
  fail,
  scope,
  safe,
  legacyWorkflowInstructions,
  createHelpdeskWorkflows,
} from '../../workflows/helpdeskWorkflows.js';
export function createHelpdeskWorkflowsController(store, chats) {
  const service = createHelpdeskWorkflows(store, chats);
  async function workflowView(user, id) {
    requireRole(user, ['admin']);
    if (
      !ObjectId.isValid(id) ||
      !(await store
        .collection('helpdeskWorkflows')
        .findOne({ ...scope(user), _id: new ObjectId(id) }))
    )
      fail('Workflow not found.', 404);
    return { ...scope(user), actorId: user.id, workflowId: id };
  }
  const postWorkflowsTest = async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    if (
      !request.body ||
      Object.keys(request.body).some((key) => !['source', 'answers'].includes(key))
    )
      fail('Invalid test fields.');
    try {
      const definition = await inspectWorkflowSource(request.body.source);
      await validateWorkflowDepartment(store, request.helpdeskUser, definition);
      await validateWorkflowReferences(store, request.helpdeskUser, definition);
      await requireExistingQueues(store, request.helpdeskUser, [
        ...definition.steps
          .filter((step) => ['route', 'handoff', 'task.create'].includes(step.action))
          .map((step) => step.params.queueName),
        ...(definition.routing || []).map((rule) => rule.queueName),
      ]);
      response.json(
        await createWorkflowExecution(store).test(
          request.helpdeskUser,
          request.body.source,
          definition,
          request.body.answers || {},
        ),
      );
    } catch (error) {
      fail(error.message);
    }
  };
  const getWorkflowSdk = async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    const root = new URL('../../../sdk/workflows/', import.meta.url);
    const [readme, source, types] = await Promise.all(
      ['README.md', 'index.js', 'index.d.ts'].map((file) => readFile(new URL(file, root), 'utf8')),
    );
    response.json({ name: '@agentzuno/workflows', version: '0.2.0', readme, source, types });
  };
  const getWorkflows = async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    const records = await store
      .collection('helpdeskWorkflows')
      .find(scope(request.helpdeskUser))
      .sort({ createdAt: 1, _id: 1 })
      .limit(50)
      .toArray();
    response.json(
      listResponse(request, records.map(safe), {
        Workflow: 'name',
        Status: (item) => (item.enabled ? 'Published' : 'Draft'),
        Updated: (item) => Date.parse(item.updatedAt),
      }),
    );
  };
  const getWorkflowsIdView = async (request, response) => {
    const filter = await workflowView(request.helpdeskUser, request.params.id);
    const preference = await store.collection('workflowConversationViews').findOne(filter);
    const latest =
      !preference &&
      (await store
        .collection('helpdeskWorkflowConversations')
        .find(filter)
        .sort({ updatedAt: -1 })
        .limit(1)
        .next());
    response.json({
      workflowId: request.params.id,
      chatId: preference ? preference.chatId : latest?.chatId || null,
    });
  };
  const putWorkflowsIdView = async (request, response) => {
    const filter = await workflowView(request.helpdeskUser, request.params.id);
    if (
      !request.body ||
      Object.keys(request.body).some((key) => key !== 'chatId') ||
      (request.body.chatId !== null && !ObjectId.isValid(request.body.chatId))
    )
      fail('Invalid workflow conversation.', 400);
    if (
      request.body.chatId &&
      !(await store
        .collection('helpdeskWorkflowConversations')
        .findOne({ ...filter, chatId: request.body.chatId }))
    )
      fail('Conversation not found for this workflow.', 404);
    await store
      .collection('workflowConversationViews')
      .updateOne(
        filter,
        { $set: { chatId: request.body.chatId, updatedAt: new Date() } },
        { upsert: true },
      );
    response.json({ workflowId: request.params.id, chatId: request.body.chatId });
  };
  const getWorkflowConversations = async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    if (request.query.workflowId && !ObjectId.isValid(request.query.workflowId))
      fail('Invalid workflow.', 400);
    const records = await store
      .collection('helpdeskWorkflowConversations')
      .find({
        ...scope(user),
        actorId: user.id,
        ...(request.query.workflowId ? { workflowId: request.query.workflowId } : {}),
      })
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(request.query.list === '1' ? 0 : 100)
      .toArray();
    const ids = records
      .map((record) => record.chatId)
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));
    const chats = await store
      .collection('chats')
      .find(
        {
          ownerId: user.id,
          workspaceId: user.workspaceId,
          helpdeskPurpose: 'workflow',
          _id: { $in: ids },
        },
        { projection: { messages: { $slice: 1 }, status: 1, updatedAt: 1 } },
      )
      .toArray();
    response.json(
      listResponse(
        request,
        chats.map((chat) => ({
          id: chat._id.toHexString(),
          title:
            (chat.messages[0]?.text || '').replace(legacyWorkflowInstructions, '').slice(0, 100) ||
            'Workflow Conversation',
          status: chat.status,
          updatedAt: chat.updatedAt,
        })),
        {
          Conversation: 'title',
          Status: 'status',
          status: 'status',
          Updated: (item) => Date.parse(item.updatedAt),
        },
        { sort: 'Updated', direction: 'desc' },
      ),
    );
  };
  const getWorkflowConversationsId = async (request, response) =>
    response.json(await service.getConversation(request.helpdeskUser, request.params.id));
  const postWorkflows = async (request, response) =>
    response.status(201).json(await service.save(request.helpdeskUser, null, request.body));
  const putWorkflowsId = async (request, response) =>
    response.json(await service.save(request.helpdeskUser, request.params.id, request.body));
  const postWorkflowConversations = async (request, response) =>
    response.status(202).json(await service.conversation(request.helpdeskUser, request.body));
  const postWorkflowConversationsIdMessages = async (request, response) =>
    response
      .status(202)
      .json(await service.followup(request.helpdeskUser, request.params.id, request.body));
  return {
    postWorkflowsTest,
    getWorkflowSdk,
    getWorkflows,
    getWorkflowsIdView,
    putWorkflowsIdView,
    getWorkflowConversations,
    getWorkflowConversationsId,
    postWorkflows,
    putWorkflowsId,
    postWorkflowConversations,
    postWorkflowConversationsIdMessages,
  };
}
