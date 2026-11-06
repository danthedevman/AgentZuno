import {
  requestFields as fields,
  requestText as text,
  requestChoice as choice,
  requestError as fail,
} from '../../requests/requestValidation.js';
import { canWorkRequest as canWork } from '../../requests/requestPolicy.js';
import { safeRequest } from '../../requests/requestPresentation.js';

import { recordMentionRecords, recordMentionDto } from '../../records/recordMentions.js';
import { requestListPage, inboxListPage } from '../../requests/requestListRepository.js';
import { queryString } from '../../shared/queryValues.js';

import { inboxMatches, requestMentionNotice } from '../../requests/mentions.js';

import { taskInboxRecords } from '../../requests/requestTasks.js';

import { canReviewWorkflowApproval } from '../../requests/approvalTargets.js';

import { listResponse, requestListColumns } from '../../shared/listQuery.js';
import {
  supportIdentity,
  supportIcons,
  validateSupportIdentity,
} from '../../channels/supportIdentity.js';

import { visibleChatTitle } from '../../chat/chatPresentation.js';

import { ObjectId } from 'mongodb';

import { requestScope, requireRole, deny } from '../../identity/helpdeskRoles.js';
import { scope, statuses, departments } from '../../requests/helpdesk.js';
export function createHelpdeskController(store, service) {
  const useApiHelpdesk = async (request, response, next) => {
    if (!request.helpdeskUser || request.helpdeskUser.isDemo)
      return response
        .status(401)
        .json({ error: 'Sign in with a registered account to use the help desk.' });
    await store.ready();
    next();
  };
  const getAiStatus = async (request, response) => {
    const scope = {
      ownerId: queryString(request.helpdeskUser.helpdeskOwnerId || request.helpdeskUser.id),
      workspaceId: queryString(request.helpdeskUser.workspaceId),
    };
    const preference = await store.collection('aiPreferences').findOne(scope);
    const provider =
      preference &&
      (await store
        .collection('aiProviders')
        .findOne(
          { ...scope, provider: preference.provider, enabled: true },
          { projection: { _id: 1 } },
        ));
    response.json({ enabled: !!provider });
  };
  const getSupportConversations = async (request, response) => {
    const user = request.helpdeskUser;
    const filter = {
      ownerId: queryString(user.id),
      workspaceId: queryString(user.workspaceId),
      helpdeskPurpose: 'support',
    };
    if (request.query.cursor !== undefined) {
      let cursor;
      try {
        if (typeof request.query.cursor !== 'string' || request.query.cursor.length > 300)
          throw new Error();
        cursor = JSON.parse(Buffer.from(request.query.cursor, 'base64url').toString());
        if (!/^[a-f0-9]{24}$/.test(cursor.id) || !Number.isFinite(Date.parse(cursor.at)))
          throw new Error();
      } catch {
        fail('Invalid chat history cursor.');
      }
      filter.$or = [
        { updatedAt: { $lt: new Date(cursor.at) } },
        { updatedAt: new Date(cursor.at), _id: { $lt: new ObjectId(cursor.id) } },
      ];
    }
    const records = await store
      .collection('chats')
      .find(filter, {
        projection: {
          title: 1,
          status: 1,
          updatedAt: 1,
          requestId: 1,
          helpdeskPurpose: 1,
          ticketReview: 1,
          helpdeskRequestId: 1,
          ownerId: 1,
          workspaceId: 1,
          messages: { $slice: 1 },
        },
      })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(16)
      .toArray();
    const page = records.slice(0, 15);
    const last = page.at(-1);
    response.json({
      items: page.map((record) => ({
        id: record._id.toHexString(),
        title: visibleChatTitle(record),
        status: record.status,
      })),
      nextCursor:
        records.length > 15
          ? Buffer.from(
              JSON.stringify({ at: last.updatedAt, id: last._id.toHexString() }),
            ).toString('base64url')
          : null,
    });
  };
  const postSupportConversations = async (request, response) =>
    response.status(202).json(await service.createSupport(request.helpdeskUser, request.body));
  const postSupportConversationsIdForm = async (request, response) =>
    response
      .status(201)
      .json(await service.submitForm(request.helpdeskUser, request.params.id, request.body));
  const postSupportConversationsIdTicket = async (request, response) =>
    response
      .status(201)
      .json(
        await service.submitSupportTicket(request.helpdeskUser, request.params.id, request.body),
      );
  const getSupportConversationsId = async (request, response) => {
    const user = request.helpdeskUser;
    if (typeof request.params.id === 'string' && /^[a-f0-9]{24}$/.test(request.params.id)) {
      const channelChat = await store.collection('chats').findOne({
        _id: new ObjectId(request.params.id),
        ownerId: queryString(user.id),
        workspaceId: queryString(user.workspaceId),
        providerOwnerId: queryString(user.helpdeskOwnerId || user.id),
        helpdeskPurpose: { $in: ['slack-support', 'teams-support'] },
      });
      if (channelChat)
        return response.json({
          redirectTo: `/workspace/${user.workspaceId}/chat`,
        });
    }
    response.json(
      service.safeSupport(
        await service.getSupport(request.helpdeskUser, request.params.id, request.query.request),
      ),
    );
  };
  const postSupportConversationsIdMessages = async (request, response) =>
    response
      .status(202)
      .json(await service.sendSupport(request.helpdeskUser, request.params.id, request.body));
  const postSupportConversationsIdActions = async (request, response) =>
    response.json(
      await service.applyChatAction(request.helpdeskUser, request.params.id, request.body),
    );
  const getChatSettings = async (request, response) => {
    const saved = await store.collection('helpdeskSettings').findOne(scope(request.helpdeskUser));
    const identity = supportIdentity(saved);
    response.json({
      greeting: saved?.chatGreeting || 'How can I help you?',
      agentName: identity.name,
      agentIcon: identity.icon,
      iconOptions: supportIcons,
    });
  };
  const putChatSettings = async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    fields(request.body, ['greeting', 'agentName', 'agentIcon']);
    const greeting = text(request.body.greeting, 'Greeting', 200);
    const saved = await store.collection('helpdeskSettings').findOne(scope(request.helpdeskUser));
    const identity = supportIdentity(saved);
    const agent = validateSupportIdentity(
      request.body.agentName ?? identity.name,
      request.body.agentIcon ?? identity.icon,
    );
    await store.collection('helpdeskSettings').updateOne(
      scope(request.helpdeskUser),
      {
        $set: { chatGreeting: greeting, ...agent, updatedAt: new Date() },
        $setOnInsert: scope(request.helpdeskUser),
      },
      { upsert: true },
    );
    response.json({
      greeting,
      agentName: agent.supportAgentName,
      agentIcon: agent.supportAgentIcon,
      iconOptions: supportIcons,
    });
  };
  const getSettings = async (request, response) =>
    response.json(await service.settings(request.helpdeskUser));
  const putSettings = async (request, response) =>
    response.json(await service.saveSettings(request.helpdeskUser, request.body));
  const postRequestsIdReview = async (request, response) => {
    response.status(202).json(await service.reviewTicket(request.helpdeskUser, request.params.id));
  };
  const getInbox = async (request, response) => {
    const user = request.helpdeskUser;
    const tab =
      request.query.tab === undefined
        ? 'primary'
        : choice(request.query.tab, ['primary', 'archive'], 'inbox tab');
    if (request.query.list === '1')
      return response.json(await inboxListPage(store, service, user, request.query, tab));
    const records = await store
      .collection('helpdeskRequests')
      .aggregate([
        {
          $match: {
            ...scope(user),
            $or: inboxMatches(user),
          },
        },
        {
          $lookup: {
            from: 'helpdeskInbox',
            let: { requestId: '$_id' },
            pipeline: [
              {
                $match: {
                  ownerId: queryString(user.id),
                  workspaceId: queryString(user.workspaceId),
                  archived: true,
                  $expr: { $eq: ['$requestId', '$$requestId'] },
                },
              },
            ],
            as: 'inboxState',
          },
        },
        { $match: { 'inboxState.0': { $exists: tab === 'archive' } } },
        { $project: { messages: 0, events: 0, approvals: 0, workNotes: 0, inboxState: 0 } },
        { $sort: { updatedAt: -1, _id: -1 } },
        ...(request.query.list === '1' ? [] : [{ $limit: 100 }]),
      ])
      .toArray();
    const submitted = await Promise.all(
      records.map(async (record) =>
        (await service.isSubmitted(record)) && (await service.canRead(user, record))
          ? record
          : null,
      ),
    );
    const taskRows = await taskInboxRecords(store, user);
    const taskStates = await store
      .collection('helpdeskInbox')
      .find({
        ownerId: queryString(user.id),
        workspaceId: queryString(user.workspaceId),
        archived: true,
      })
      .toArray();
    const rows = submitted.filter(Boolean).map((record) => ({
      ...service.safeRequest(record, user),
      inboxNotice: requestMentionNotice(user, record),
    }));
    const mentions = await recordMentionRecords(store, user);
    rows.push(
      ...mentions
        .filter(
          (entry) =>
            taskStates.some(
              (state) =>
                state.kind === 'record-mention' && String(state.requestId) === String(entry._id),
            ) ===
            (tab === 'archive'),
        )
        .map(recordMentionDto),
    );
    rows.push(
      ...taskRows.filter(
        (task) =>
          taskStates.some((state) => String(state.taskId) === task.id) === (tab === 'archive'),
      ),
    );
    response.json(
      listResponse(request, rows, requestListColumns, { sort: 'Updated', direction: 'desc' }),
    );
  };
  const putInboxId = async (request, response) => {
    const user = request.helpdeskUser;
    fields(request.body, ['archived']);
    if (typeof request.body.archived !== 'boolean') fail('Choose whether to archive this item.');
    const task = (await taskInboxRecords(store, user)).find(
      (task) => task.id === request.params.id,
    );
    const mention = (await recordMentionRecords(store, user)).find(
      (entry) => String(entry._id) === request.params.id,
    );
    let filter;
    if (mention)
      filter = {
        ownerId: queryString(user.id),
        workspaceId: queryString(user.workspaceId),
        requestId: mention._id,
        kind: 'record-mention',
      };
    else if (task)
      filter = {
        ownerId: queryString(user.id),
        workspaceId: queryString(user.workspaceId),
        taskId: new ObjectId(task.id),
        requestId: new ObjectId(task.id),
        kind: 'task',
      };
    else {
      const record = await service.get(user, request.params.id);
      if (
        !(user.queues || []).includes(record.queueName) &&
        !(record.notifications || []).some(
          (item) =>
            item.recipientId === user.id && (item.kind !== 'work-note' || canWork(user, record)),
        ) &&
        !(await canReviewWorkflowApproval(store, user, record._id))
      )
        deny('This item is outside your assignments.');
      filter = {
        ownerId: queryString(user.id),
        workspaceId: queryString(user.workspaceId),
        requestId: record._id,
      };
    }
    await store
      .collection('helpdeskInbox')
      .updateOne(
        filter,
        { $set: { archived: request.body.archived, updatedAt: new Date() }, $setOnInsert: filter },
        { upsert: true },
      );
    response.json({ id: request.params.id, archived: request.body.archived });
  };
  const getRequests = async (request, response) => {
    const filter = requestScope(request.helpdeskUser);
    if (request.query.status !== undefined)
      filter.status = choice(request.query.status, statuses, 'status');
    if (request.query.department !== undefined)
      filter.department = choice(request.query.department, departments, 'department');
    if (request.query.list === '1')
      return response.json(
        await requestListPage(store, service, request.helpdeskUser, request.query, filter),
      );
    const records = await store
      .collection('helpdeskRequests')
      .find(filter, { projection: { messages: 0, events: 0, approvals: 0, workNotes: 0 } })
      .sort({ updatedAt: -1, _id: -1 })
      .limit(request.query.list === '1' ? 0 : 100)
      .toArray();
    const submitted = await Promise.all(
      records.map(async (record) =>
        (await service.isSubmitted(record)) && (await service.canRead(request.helpdeskUser, record))
          ? record
          : null,
      ),
    );
    response.json(
      listResponse(
        request,
        submitted
          .filter(Boolean)
          .slice(0, request.query.list === '1' ? undefined : 50)
          .map((record) => service.safeRequest(record, request.helpdeskUser)),
        requestListColumns,
        { sort: 'Updated', direction: 'desc' },
      ),
    );
  };
  const postRequests = async (request, response) =>
    response.status(201).json(await service.create(request.helpdeskUser, request.body));
  const getRequestsId = async (request, response) => {
    const record = await service.get(request.helpdeskUser, request.params.id);
    const result = safeRequest(record, request.helpdeskUser);
    result.workflow = null;
    if (record.workflowId && ObjectId.isValid(record.workflowId)) {
      const workflow = await store
        .collection('helpdeskWorkflows')
        .findOne(
          { ...scope(request.helpdeskUser), _id: new ObjectId(record.workflowId) },
          { projection: { name: 1, publishedConfig: 1 } },
        );
      result.workflow = {
        id: record.workflowId,
        name:
          request.helpdeskUser.role === 'admin'
            ? workflow?.name || record.workflowName || 'Workflow'
            : workflow?.publishedConfig?.name ||
              record.workflowName ||
              workflow?.name ||
              'Workflow',
        version: record.workflowVersion || null,
        canOpen: request.helpdeskUser.role === 'admin' && !!workflow,
      };
    }
    if (record.channel === 'email') {
      const thread = await store
        .collection('helpdeskEmailThreads')
        .findOne({ ...scope(request.helpdeskUser), requestId: request.params.id });
      result.emailReplies = thread
        ? await store
            .collection('helpdeskEmailMessages')
            .find(
              { threadKey: thread._id },
              { projection: { status: 1, responseId: 1, sentAt: 1, draftText: 1 } },
            )
            .sort({ createdAt: -1 })
            .limit(25)
            .toArray()
        : [];
      result.emailReplies = result.emailReplies.map(
        ({ status, responseId, sentAt, draftText }) => ({
          status,
          responseId,
          sentAt,
          ...(canWork(request.helpdeskUser, record) && draftText
            ? { draftText: draftText.slice(0, 8000) }
            : {}),
        }),
      );
    }
    response.json(result);
  };
  const patchRequestsId = async (request, response) =>
    response.json(await service.update(request.helpdeskUser, request.params.id, request.body));
  const postRequestsIdPath = (path, action) => async (request, response) =>
    response.json(
      await service.update(request.helpdeskUser, request.params.id, request.body, action),
    );
  const getRequestsIdDraftsChatId = async (request, response) =>
    response.json(
      await service.getDraft(request.helpdeskUser, request.params.id, request.params.chatId),
    );
  const postRequestsIdDrafts = async (request, response) =>
    response
      .status(202)
      .json(await service.draft(request.helpdeskUser, request.params.id, request.body));
  return {
    useApiHelpdesk,
    getAiStatus,
    getSupportConversations,
    postSupportConversations,
    postSupportConversationsIdForm,
    postSupportConversationsIdTicket,
    getSupportConversationsId,
    postSupportConversationsIdMessages,
    postSupportConversationsIdActions,
    getChatSettings,
    putChatSettings,
    getSettings,
    putSettings,
    postRequestsIdReview,
    getInbox,
    putInboxId,
    getRequests,
    postRequests,
    getRequestsId,
    patchRequestsId,
    postRequestsIdPath,
    getRequestsIdDraftsChatId,
    postRequestsIdDrafts,
  };
}
