import { ObjectId } from 'mongodb';
import { deny } from '../identity/helpdeskRoles.js';
export function validateWorkflowAction(definition, action, id, input) {
  if (
    typeof id !== 'string' ||
    !/^[a-z][a-z0-9-]{0,39}$/.test(id) ||
    !input ||
    Array.isArray(input) ||
    typeof input !== 'object'
  )
    deny('Invalid workflow action.', 400);
  if (
    ![
      'route',
      'handoff',
      'approval',
      'slack.postMessage',
      'task.create',
      'task.wait',
      'data.read',
      'data.create',
      'data.update',
      'data.delete',
    ].includes(action)
  )
    deny('Unsupported workflow action.', 400);
  const allowed = [
    ...definition.steps,
    ...(definition.routing || []).map((rule) => ({
      id: rule.id,
      action: rule.action,
      params: { queueName: rule.queueName },
    })),
  ];
  const declared = allowed.find((step) => step.id === id && step.action === action);
  if (!declared) deny('This action is outside the published action manifest.');
  if (action === 'task.wait') {
    if (
      Object.keys(input).some((key) => key !== 'taskId') ||
      typeof input.taskId !== 'string' ||
      !/^[a-f0-9]{24}$/.test(input.taskId)
    )
      deny('Choose a created task.', 400);
    return;
  }
  if (action.startsWith('data.')) {
    if (
      Object.keys(input).some(
        (key) => !['tableId', 'recordId', 'version', 'values'].includes(key),
      ) ||
      input.tableId !== declared.params.tableId
    )
      deny('Data table is outside the workflow grant.');
    if (
      action !== 'data.create' &&
      (typeof input.recordId !== 'string' || !/^[a-f0-9]{24}$/.test(input.recordId))
    )
      deny('Choose a record.', 400);
    if (
      ['data.update', 'data.delete'].includes(action) &&
      (!Number.isSafeInteger(input.version) || input.version < 0)
    )
      deny('Use the current record version.', 400);
    if (
      ['data.create', 'data.update'].includes(action) &&
      (!input.values ||
        typeof input.values !== 'object' ||
        Array.isArray(input.values) ||
        Object.keys(input.values).some((key) => !declared.params.fields.includes(key)))
    )
      deny('Fields are outside the workflow grant.');
    return;
  }
  if (['route', 'handoff'].includes(action)) {
    if (
      Object.keys(input).some((key) => key !== 'queueName') ||
      input.queueName !== declared.params.queueName
    )
      deny('Queue is outside the workflow grant.');
  } else if (action === 'task.create') {
    if (
      Object.keys(input).some((key) => !['queueName', 'title', 'description'].includes(key)) ||
      input.queueName !== declared.params.queueName ||
      typeof input.title !== 'string' ||
      !input.title.trim() ||
      input.title.length > 160 ||
      typeof input.description !== 'string' ||
      input.description.length > 2000
    )
      deny('Invalid task details or assignment group.', 400);
  } else if (action === 'slack.postMessage') {
    if (
      Object.keys(input).some((key) => !['channel', 'text'].includes(key)) ||
      input.channel !== declared.params.channel ||
      !(input.channel === 'requester' || /^[CGUW][A-Z0-9]{2,39}$/.test(input.channel)) ||
      typeof input.text !== 'string' ||
      !input.text.trim() ||
      input.text.length > 2000
    )
      deny('Invalid Slack message target or text.', 400);
  } else {
    if (
      Object.keys(input).some((key) => !['target', 'userId', 'groupId', 'reason'].includes(key)) ||
      typeof input.reason !== 'string' ||
      !input.reason.trim() ||
      input.reason.length > 2000
    )
      deny('Select an approver and provide a reason.', 400);
    const target = input.target || (input.groupId ? 'group' : 'user');
    if (
      !['user', 'group', 'manager'].includes(target) ||
      (target === 'user' &&
        (typeof input.userId !== 'string' || !input.userId || input.userId.length > 80)) ||
      (target === 'group' &&
        (typeof input.groupId !== 'string' || !ObjectId.isValid(input.groupId)))
    )
      deny('Invalid approval target.', 400);
    if (
      declared.params.target &&
      (target !== declared.params.target ||
        input.userId !== declared.params.userId ||
        input.groupId !== declared.params.groupId)
    )
      deny('Approval target is outside the workflow grant.');
  }
}
