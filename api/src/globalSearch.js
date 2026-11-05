import { createRequestTasks } from './requestTasks.js';
import { helpdeskScope, requestScope, deny } from './helpdeskRoles.js';
import { canReadAuthoredArticle, knowledgeAllowed } from './knowledgeAccess.js';
import { canUseWorkflow } from '../sdk/workflows/index.js';
import { matchesWorkflowDepartment } from './workflowDepartments.js';
import { createAdminData } from './adminData.js';
import { listResponse } from './listQuery.js';

export async function searchWorkspace(store, user, term, helpdesk) {
  if (typeof term !== 'string' || term.length > 200) deny('Search with up to 200 characters.', 400);
  if (!term.trim()) return [];
  const regex = new RegExp(term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const scope = helpdeskScope(user),
    rows = [];
  const contentScope = {
    ownerId: scope.ownerId,
    $and: [{ $or: [{ workspaceId: scope.workspaceId }, { workspaceId: { $exists: false } }] }],
  };
  const fileScope = {
    ownerId: user.id,
    ...(scope.ownerId === user.id
      ? {
          $and: [
            { $or: [{ workspaceId: scope.workspaceId }, { workspaceId: { $exists: false } }] },
          ],
        }
      : { workspaceId: scope.workspaceId }),
  };
  const matching = (fields) => ({ $or: fields.map((field) => ({ [field]: regex })) });
  const find = (name, filter) => store.collection(name).find(filter).limit(30).toArray();
  const push = (record, type, icon, title, href, summary = '') =>
    rows.push({ id: `${type}:${record._id || record.id}`, title, type, icon, href, summary });
  async function permitted(action) {
    try {
      return await action();
    } catch (error) {
      if ([403, 404].includes(error.status)) return null;
      throw error;
    }
  }
  const [requests, tasks, articles, records, chats, workflows, files, images] = await Promise.all([
    find('helpdeskRequests', {
      ...requestScope(user),
      ...matching([
        'title',
        'description',
        'number',
        'formSubmission.answers.value',
        'formSubmission.answers.label',
      ]),
    }),
    find('helpdeskTasks', { ...scope, ...matching(['title', 'description']) }),
    find('articles', { ...contentScope, ...matching(['title', 'body', 'summary']) }),
    find('records', {
      ...contentScope,
      type: { $in: ['knowledge-base', 'topic'] },
      ...matching(['name', 'description']),
    }),
    find('chats', {
      ownerId: user.id,
      workspaceId: user.workspaceId,
      providerOwnerId: scope.ownerId,
      helpdeskPurpose: 'support',
      ...matching(['title', 'messages.text']),
    }),
    find('helpdeskWorkflows', {
      ...scope,
      ...(user.role === 'admin' ? {} : { enabled: true }),
      ...matching(['name', 'publishedConfig.name']),
    }),
    find('files', { ...fileScope, ...matching(['name', 'filename', 'title']) }),
    find('images', { ...fileScope, ...matching(['name', 'filename', 'title']) }),
  ]);
  for (const record of requests)
    if (await permitted(() => helpdesk.get(user, String(record._id))))
      push(
        record,
        'Request',
        'request',
        record.title,
        `/workspace/chat/${record.chatId}?request=${record._id}`,
        record.number || '',
      );
  for (const task of tasks) {
    const authorized = await permitted(() => createRequestTasks(store).get(user, String(task._id)));
    if (authorized)
      push(task, 'Task', 'task', task.title, `/workspace/tasks/${task._id}`, 'Fulfillment Task');
  }
  for (const article of articles)
    if (await canReadAuthoredArticle(store, user, article))
      push(article, 'Article', 'book', article.title, `/workspace/articles/${article._id}`);
  for (const record of records) {
    const baseId =
      record.type === 'knowledge-base' ? String(record._id) : record.base || record.knowledgeBaseId;
    if (!baseId || !(await knowledgeAllowed(store, user, 'base', baseId))) continue;
    if (
      record.type === 'topic' &&
      !(await knowledgeAllowed(store, user, 'topic', String(record._id)))
    )
      continue;
    push(
      record,
      record.type === 'topic' ? 'Topic' : 'Knowledge Base',
      'book',
      record.name,
      user.role === 'admin'
        ? `/workspace/knowledge/bases/${baseId}`
        : `/workspace/knowledge?base=${baseId}${record.type === 'topic' ? `&topic=${record._id}` : ''}`,
    );
  }
  for (const chat of chats)
    if (await permitted(() => helpdesk.getSupport(user, String(chat._id))))
      push(chat, 'Chat', 'chat', chat.title, `/workspace/chat/${chat._id}`);
  for (const workflow of workflows) {
    if (user.role === 'admin')
      push(
        workflow,
        'Workflow',
        'workflow',
        workflow.name,
        `/workspace/workflows/${workflow._id}/edit`,
      );
    else {
      const published = workflow.publishedConfig || workflow;
      if (
        published.definition?.form &&
        published.definition.displayInCatalog &&
        canUseWorkflow(published.definition, user) &&
        (await matchesWorkflowDepartment(store, user, published.definition))
      )
        push(
          workflow,
          'Catalog Item',
          'catalog',
          published.name,
          `/workspace/catalog?q=${encodeURIComponent(published.name)}`,
        );
    }
  }
  for (const [values, type, icon, path] of [
    [files, 'File', 'file', 'files'],
    [images, 'Image', 'image', 'images'],
  ])
    for (const record of values)
      push(
        record,
        type,
        icon,
        record.title || record.filename || record.name,
        `/workspace/${path}/${record._id}`,
      );
  if (user.role === 'admin') {
    const data = createAdminData(store);
    for (const table of await data.tables(user))
      if (regex.test(table.name) || regex.test(table.description))
        push(table, 'Data Table', 'data', table.name, `/workspace/data/${table.id}`);
    const [members, groups, dataRecords, references] = await Promise.all([
      find('helpdeskMembers', { ...scope, ...matching(['email']) }),
      find('approvalGroups', { ...scope, ...matching(['name', 'description']) }),
      find('adminDataRecords', {
        ...scope,
        archived: { $ne: true },
        $expr: {
          $anyElementTrue: {
            $map: {
              input: { $objectToArray: { $ifNull: ['$values', {}] } },
              as: 'field',
              in: {
                $regexMatch: {
                  input: {
                    $convert: { input: '$$field.v', to: 'string', onError: '', onNull: '' },
                  },
                  regex: regex.source,
                  options: 'i',
                },
              },
            },
          },
        },
      }),
      find('workforceReferences', { ...scope, ...matching(['name', 'description']) }),
    ]);
    const accounts = await find('users', {
      id: {
        $in: (await store.collection('helpdeskMembers').find(scope).toArray()).map(
          (member) => member.userId,
        ),
      },
      ...matching(['name', 'email']),
    });
    const people = new Map([
      ...members.map((member) => [member.userId, { ...member, id: member.userId }]),
      ...accounts.map((account) => [account.id, account]),
    ]);
    for (const person of people.values())
      push(person, 'User', 'profile', person.name || person.email, `/workspace/users/${person.id}`);
    for (const group of groups)
      push(group, 'Group', 'users', group.name, `/workspace/users/groups/${group._id}`);
    for (const record of dataRecords)
      if (await permitted(() => data.table(user, record.tableId)))
        push(
          record,
          'Data Record',
          'data',
          String(record.values?.name || Object.values(record.values || {})[0] || 'Record'),
          `/workspace/data/${record.tableId}/records/${record._id}`,
        );
    for (const record of references)
      push(
        record,
        'Data Record',
        'data',
        record.name,
        `/workspace/data/ref-${record.type === 'costCenter' ? 'cost-center' : record.type}/records/${record._id}`,
      );
  }
  return rows;
}
export function installGlobalSearch(app, store, helpdesk) {
  app.get('/api/helpdesk/global-search', async (request, response) => {
    const rows = await searchWorkspace(
      store,
      request.helpdeskUser,
      request.query.q || '',
      helpdesk,
    );
    response.json(
      listResponse(
        { query: { ...request.query, q: '' } },
        rows,
        { Name: 'title', Type: 'type', Summary: 'summary' },
        { sort: 'Name' },
      ),
    );
  });
}
