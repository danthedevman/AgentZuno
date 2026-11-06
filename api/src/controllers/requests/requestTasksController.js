import { helpdeskScope, requireRole, deny } from '../../identity/helpdeskRoles.js';
import { listResponse } from '../../shared/listQuery.js';

import { taskAssignmentMatches, createRequestTasks } from '../../requests/requestTasks.js';
export function createRequestTasksController(store) {
  const service = createRequestTasks(store);
  const getTasks = async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin', 'agent', 'read-only']);
    const filter = {
      ...helpdeskScope(user),
      ...(user.role === 'agent' ? { $or: taskAssignmentMatches(user) } : {}),
    };
    const records = await store.collection('helpdeskTasks').find(filter).toArray();
    response.json(
      listResponse(
        request,
        records.map(({ _id, ownerId, workspaceId, ...record }) => ({ id: String(_id), ...record })),
        {
          Task: 'title',
          Status: 'status',
          'Due Date': 'dueDate',
          'Assignment Group': 'queueName',
          'Assigned To': 'assignedToName',
          Updated: (record) => Date.parse(record.updatedAt),
        },
        { sort: 'Updated', direction: 'desc' },
      ),
    );
  };
  const getTasksTaskId = async (request, response) =>
    response.json(await service.get(request.helpdeskUser, request.params.taskId));
  const getTasksTaskIdAssignees = async (request, response) => {
    const user = request.helpdeskUser,
      task = await service.get(user, request.params.taskId);
    if (!task.permissions.canEdit) deny();
    const members = await store
      .collection('helpdeskMembers')
      .find({
        ...helpdeskScope(user),
        active: true,
        role: { $in: ['admin', 'agent'] },
        queues: task.queueName,
      })
      .toArray();
    const users = await store
      .collection('users')
      .find(
        { id: { $in: members.map((member) => member.userId) } },
        { projection: { id: 1, name: 1 } },
      )
      .toArray();
    response.json(
      members.map((member) => ({
        value: member.userId,
        label: users.find((person) => person.id === member.userId)?.name || member.email,
        href: `/workspace/users/${member.userId}`,
      })),
    );
  };
  const putTasksTaskId = async (request, response) => {
    const task = await service.get(request.helpdeskUser, request.params.taskId);
    await service.update(request.helpdeskUser, task.requestId, task.id, request.body);
    response.json(await service.get(request.helpdeskUser, task.id));
  };
  const getRequestsIdTasks = async (request, response) =>
    response.json(
      listResponse(request, await service.list(request.helpdeskUser, request.params.id), {
        Task: 'title',
        Status: 'status',
        Updated: 'updatedAt',
      }),
    );
  const postRequestsIdTasks = async (request, response) =>
    response
      .status(201)
      .json(await service.create(request.helpdeskUser, request.params.id, request.body));
  const putRequestsIdTasksTaskId = async (request, response) =>
    response.json(
      await service.update(
        request.helpdeskUser,
        request.params.id,
        request.params.taskId,
        request.body,
      ),
    );
  return {
    getTasks,
    getTasksTaskId,
    getTasksTaskIdAssignees,
    putTasksTaskId,
    getRequestsIdTasks,
    postRequestsIdTasks,
    putRequestsIdTasksTaskId,
  };
}
