import { ObjectId } from 'mongodb';
import { createHash } from 'node:crypto';
import { helpdeskScope, requireRole, deny } from './helpdeskRoles.js';
import { canReadAuthoredArticle } from './knowledgeAccess.js';
import { createAdminData } from './adminData.js';

export function installRecentViewRoutes(app, store, helpdesk) {
  const data = createAdminData(store);
  async function resolve(user, href) {
    const path = href.replace(`/workspace/${user.workspaceId}/`, '/workspace/');
    const match = path.match(
      /^\/workspace\/(articles|workflows|chat|requests|users|data)\/([a-zA-Z0-9-]{1,80})(?:\/(edit|records)\/?([a-zA-Z0-9-]{1,80})?)?$/,
    );
    if (!match || ['new', 'queues', 'groups'].includes(match[2])) return null;
    const [, kind, id, action, recordId] = match;
    let title, type, icon;
    if (kind === 'articles') {
      if (!ObjectId.isValid(id)) return null;
      const article = await store
        .collection('articles')
        .findOne({ _id: new ObjectId(id), ownerId: helpdeskScope(user).ownerId });
      if (!article || !(await canReadAuthoredArticle(store, user, article))) return null;
      title = article.title;
      type = 'Article';
      icon = 'book';
    } else if (kind === 'chat' || kind === 'requests') {
      const record =
        kind === 'chat' ? await helpdesk.getSupport(user, id) : await helpdesk.get(user, id);
      title = record.title;
      type = kind === 'chat' ? 'Chat' : 'Request';
      icon = kind === 'chat' ? 'chat' : 'request';
    } else {
      requireRole(user, ['admin']);
      if (kind === 'data') {
        const table = await data.table(user, id);
        if (action === 'records') {
          if (recordId === 'new') return null;
          const record = (await data.records(user, id)).find(
            (item) => String(item.id) === recordId,
          );
          if (!record) return null;
          title = String(record.values.name || Object.values(record.values)[0] || table.name);
          type = table.name;
        } else {
          title = table.name;
          type = 'Data Table';
        }
        icon = 'data';
      } else if (kind === 'users') {
        const member = await store
          .collection('helpdeskMembers')
          .findOne({ ...helpdeskScope(user), userId: id, active: true });
        if (!member) return null;
        const account = await store
          .collection('users')
          .findOne({ id }, { projection: { name: 1 } });
        title = account?.name || member.email;
        type = 'User';
        icon = 'user';
      } else {
        if (!ObjectId.isValid(id)) return null;
        const record = await store
          .collection('helpdeskWorkflows')
          .findOne({ ...helpdeskScope(user), _id: new ObjectId(id) });
        if (!record) return null;
        title = record.name;
        type = 'Workflow';
        icon = 'workflow';
      }
    }
    return { href: path, title, type, icon, summary: '' };
  }
  app.post('/api/helpdesk/recent-views', async (request, response) => {
    const user = request.helpdeskUser;
    if (
      typeof request.body?.href !== 'string' ||
      request.body.href.length > 300 ||
      Object.keys(request.body).some((key) => key !== 'href')
    )
      deny('Invalid recent view.', 400);
    let item;
    try {
      item = await resolve(user, request.body.href);
    } catch (error) {
      if (![403, 404].includes(error.status)) throw error;
    }
    if (item) {
      const _id = createHash('sha256')
        .update(JSON.stringify([user.id, user.workspaceId, item.href]))
        .digest('hex');
      await store
        .collection('recentViews')
        .updateOne(
          { _id, actorId: user.id, ...helpdeskScope(user) },
          { $set: { href: item.href, viewedAt: new Date() } },
          { upsert: true },
        );
    }
    response.json({ recorded: !!item });
  });
  app.get('/api/helpdesk/recent-views', async (request, response) => {
    const user = request.helpdeskUser;
    const history = await store
      .collection('recentViews')
      .find({ actorId: user.id, ...helpdeskScope(user) })
      .sort({ viewedAt: -1 })
      .limit(20)
      .toArray();
    const rows = [];
    for (const item of history) {
      try {
        const record = await resolve(user, item.href);
        if (record) rows.push(record);
      } catch (error) {
        if (![403, 404].includes(error.status)) throw error;
      }
      if (rows.length === 5) break;
    }
    response.json(rows);
  });
}
