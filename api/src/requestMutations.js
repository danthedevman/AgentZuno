import { randomUUID } from 'node:crypto';
import { queryString, queryVersion } from './queryValues.js';
import { requestScope, requireRequestOperator, deny } from './helpdeskRoles.js';
import { prepareMentions } from './mentions.js';
import { requestFields as fields, requestText as text, requestChoice as choice, requestError as fail } from './requestValidation.js';

export function createRequestMutations(store, { get, settings, canRead, safeRequest, departments, statuses }) {
  const requests = () => store.collection('helpdeskRequests');
  async function update(user, id, input, action) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid request.');
    const record = await get(user, id);
    if (!['message', 'requester-message'].includes(action)) requireRequestOperator(user, record);
    if (action === 'decision' && !user.canApprove) deny('Approval permission is required.');
    if (!Number.isInteger(input.version) || input.version !== record.version)
      fail('Request changed. Reload before saving.', 409);
    if (record.events.length >= 200) fail('Request history limit reached.', 422);
    const now = new Date();
    const changes = {};
    let pendingNotifications = [];
    let event;
    if (action === 'assign-self') {
      fields(input, ['version']);
      if (record.status === 'resolved') fail('Reopen the request before assigning it.', 409);
      if (!(user.queues || []).includes(record.queueName))
        deny('This request is outside your assigned queues.');
      if (record.assignedToId && record.assignedToId !== user.id)
        fail('This request is already assigned.', 409);
      changes.assignedToId = user.id;
      changes.assignedToName = user.name || user.email || 'Agent';
      event = { type: 'assigned', assignedToId: queryString(user.id) };
    } else if (action === 'work-note') {
      fields(input, ['version', 'text', 'mentionIds']);
      const body = text(input.text, 'Work note', 8000);
      if (
        (record.workNotes || []).length >= 100 ||
        (record.workNotes || []).reduce((size, note) => size + note.text.length, 0) + body.length >
          180000
      )
        fail('Work note limit reached.', 422);
      changes.workNotes = [
        ...(record.workNotes || []),
        {
          id: randomUUID(),
          authorId: user.id,
          authorName: user.name || user.email || 'Support',
          text: body,
          createdAt: now,
        },
      ];
      event = { type: 'work-note-added' };
    } else if (['message', 'requester-message'].includes(action)) {
      if (action === 'requester-message' && record.requesterId !== user.id) deny();
      fields(input, ['version', 'text', 'mentionIds']);
      if (record.status === 'resolved') fail('Reopen the request before replying.', 409);
      const body = text(input.text, 'Message', 8000);
      if (
        record.messages.length >= 100 ||
        record.messages.reduce((size, message) => size + message.text.length, 0) + body.length >
          180000
      )
        fail('Conversation limit reached.', 422);
      changes.messages = [
        ...record.messages,
        {
          id: randomUUID(),
          authorId: user.id,
          authorName: user.name || user.email || 'Requester',
          kind: 'comment',
          role:
            action === 'requester-message' ||
            user.role === 'user' ||
            (user.role === 'agent' && !user.queues.includes(record.queueName))
              ? 'requester'
              : 'operator',
          text: body,
          createdAt: now,
        },
      ];
      event = { type: 'comment-added' };
    } else if (action === 'approval') {
      fields(input, ['version', 'action', 'reason']);
      if (
        record.status === 'resolved' ||
        record.approvals.some((approval) => approval.status === 'pending')
      )
        fail('Request cannot accept another approval.', 409);
      const approval = {
        id: randomUUID(),
        action: choice(
          input.action,
          ['access-request', 'software-request', 'policy-exception'],
          'approval action',
        ),
        reason: text(input.reason, 'Reason', 2000),
        status: 'pending',
        executionStatus: 'not-executed',
        createdAt: now,
      };
      changes.approvals = [...record.approvals, approval];
      changes.status = 'waiting-for-approval';
      event = { type: 'approval-requested', approvalId: approval.id };
    } else if (action === 'decision') {
      fields(input, ['version', 'approvalId', 'decision', 'comment']);
      const approval = record.approvals.find(
        (item) => item.id === input.approvalId && item.status === 'pending',
      );
      if (!approval) fail('Pending approval not found.', 404);
      const decision = choice(input.decision, ['approved', 'rejected'], 'decision');
      const comment =
        input.comment === undefined || input.comment === ''
          ? ''
          : text(input.comment, 'Comment', 2000);
      changes.approvals = record.approvals.map((item) =>
        item.id === approval.id
          ? { ...item, status: decision, decidedBy: user.id, decidedAt: now, comment }
          : item,
      );
      changes.status = 'open';
      event = { type: 'approval-decided', approvalId: approval.id, decision };
    } else {
      fields(input, ['version', 'status', 'department', 'priority']);
      if (Object.keys(input).length === 1) fail('Provide a change.');
      if (input.status !== undefined) {
        choice(input.status, statuses, 'status');
        if (input.status === 'waiting-for-approval') fail('Create an approval to use this status.');
        if (record.approvals.some((item) => item.status === 'pending'))
          fail('Decide the pending approval first.', 409);
        changes.status = input.status;
      }
      if (input.priority !== undefined)
        changes.priority = choice(input.priority, ['low', 'normal', 'high', 'urgent'], 'priority');
      if (input.department !== undefined) {
        changes.department = choice(input.department, departments, 'department');
        const config = await settings(user, true);
        changes.queueName =
          config.routing.find((route) => route.department === input.department)?.queueName ||
          input.department;
      }
      if (user.role === 'agent' && changes.queueName && !user.queues.includes(changes.queueName))
        deny('You can only route requests to your assigned queues.');
      event = { type: 'updated', changes: { ...changes } };
    }
    if (['message', 'requester-message', 'work-note'].includes(action)) {
      const kind = action === 'work-note' ? 'work-note' : 'comment';
      const entry = kind === 'work-note' ? changes.workNotes.at(-1) : changes.messages.at(-1);
      const prepared = await prepareMentions(
        store,
        { canRead },
        user,
        record,
        entry,
        input.mentionIds,
        kind,
      );
      entry.mentions = prepared.mentions;
      pendingNotifications = prepared.notifications;
    }
    const updated = await requests().findOneAndUpdate(
      { ...requestScope(user), _id: record._id, version: queryVersion(input.version) },
      {
        $set: { ...changes, updatedAt: now },
        $inc: { version: 1 },
        $push: {
          events: { ...event, actorId: user.id, at: now },
          ...(pendingNotifications.length
            ? { notifications: { $each: pendingNotifications } }
            : {}),
        },
      },
      { returnDocument: 'after' },
    );
    if (!updated) fail('Request changed. Reload before saving.', 409);
    return safeRequest(updated, user);
  }
  return update;
}
