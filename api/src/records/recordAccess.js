import { ObjectId } from 'mongodb';
import { helpdeskScope, deny } from '../identity/helpdeskRoles.js';
import { createRequestTasks } from '../requests/requestTasks.js';
import { createAdminData } from '../data/adminData.js';
export async function authorizeRecord(store, user, kind, id, tableId) {
  if (
    typeof id !== 'string' ||
    !/^[a-f0-9]{24}$/.test(id) ||
    !['task', 'group', 'data'].includes(kind)
  )
    deny('Record not found.', 404);
  let record,
    canWrite = false,
    canReadNotes = false;
  if (kind === 'task') {
    record = await createRequestTasks(store).get(user, id);
    canWrite = ['admin', 'agent', 'user'].includes(user.role);
    canReadNotes =
      ['admin', 'read-only'].includes(user.role) ||
      (user.role === 'agent' &&
        ((user.queues || []).includes(record.queueName) || record.assignedToId === user.id));
  } else {
    if (user.role !== 'admin' && !(user.role === 'read-only' && user.readOnlyRequest)) deny();
    if (kind === 'group')
      record = await store
        .collection('approvalGroups')
        .findOne({ ...helpdeskScope(user), _id: new ObjectId(id) });
    else {
      if (typeof tableId !== 'string' || !/^(?:ref-[a-z-]{1,60}|[a-f0-9]{24})$/.test(tableId))
        deny('Invalid data table.', 400);
      record = (await createAdminData(store).records(user, tableId)).find((item) => item.id === id);
    }
    if (!record) deny('Record not found.', 404);
    canWrite = user.role === 'admin';
    canReadNotes = true;
  }
  const title =
    record.title || record.name || record.values?.name || record.values?.title || 'Record';
  const href =
    kind === 'task'
      ? `/workspace/tasks/${id}`
      : kind === 'group'
        ? `/workspace/users/groups/${id}`
        : `/workspace/data/${tableId}/records/${id}`;
  return {
    title: typeof title === 'string' ? title.slice(0, 160) : 'Record',
    href,
    scope: {
      ...helpdeskScope(user),
      kind,
      recordId: id,
      tableId: kind === 'data' ? tableId : '',
    },
    canComment: canWrite && user.role !== 'read-only',
    canNote: canWrite && canReadNotes && ['admin', 'agent'].includes(user.role),
    canReadNotes,
  };
}
