import { adapterRegistry } from './registry.js';
import sanitizeHtml from 'sanitize-html';

const text = (html = '') =>
  sanitizeHtml(String(html), { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
function problem(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function sourceClient(provider, config, accessToken, fetcher = fetch) {
  const adapter = adapterRegistry[provider];
  if (adapter?.create)
    return {
      ...adapter.create(config, accessToken, fetcher),
      supportsUserPermissions: !!adapter.sourcePermissionsSupported,
    };
  let base;
  const tenant = String(config.tenant || '').toLowerCase();
  if (provider === 'notion') base = 'https://api.notion.com';
  else if (provider === 'zendesk' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant))
    base = `https://${tenant}.zendesk.com`;
  else if (provider === 'servicenow' && /^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant))
    base = `https://${tenant}.service-now.com`;
  else if (
    provider === 'confluence' &&
    config.authType === 'basic' &&
    /^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant)
  )
    base = `https://${tenant}.atlassian.net/wiki`;
  else if (provider === 'confluence' && /^[a-f0-9-]{36}$/.test(config.cloudId || ''))
    base = `https://api.atlassian.com/ex/confluence/${config.cloudId}/wiki`;
  else
    throw problem('This adapter is not implemented, or its tenant settings are incomplete.', 501);
  const namespace = config.namespace || 'x_agentzuno';
  if (provider === 'servicenow' && !/^x_[a-z0-9_]{1,78}$/.test(namespace))
    throw problem('Enter a valid ServiceNow application namespace.');
  const serviceNowPath = `/api/${namespace}/knowledge`;
  async function request(path, options = {}) {
    const url = new URL(path.startsWith('https:') ? path : base + path);
    const root = new URL(base);
    if (
      url.origin !== root.origin ||
      !url.pathname.startsWith(root.pathname === '/' ? '/' : root.pathname + '/')
    )
      throw problem('The source returned an unexpected URL.');
    const response = await fetcher(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
      headers: {
        Authorization:
          ['basic', 'api-key'].includes(config.authType) &&
          ['zendesk', 'confluence', 'servicenow'].includes(provider)
            ? `Basic ${Buffer.from(`${config.username}${provider === 'zendesk' ? '/token' : ''}:${accessToken}`).toString('base64')}`
            : `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(provider === 'notion' ? { 'Notion-Version': '2022-06-28' } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const retryAfter = retry
        ? Math.min(
            3600000,
            Math.max(
              1000,
              Number.isFinite(Number(retry))
                ? Number(retry) * 1000
                : Date.parse(retry) - Date.now(),
            ),
          )
        : 30000;
      throw Object.assign(
        problem(
          response.status === 401 || response.status === 403 || response.status === 404
            ? 'Source access could not be verified.'
            : 'The source is unavailable or rate limited.',
          response.status === 429 ? 429 : 502,
        ),
        { retryAfter: Number.isFinite(retryAfter) ? retryAfter : 30000 },
      );
    }
    const content = await response.text();
    if (content.length > 4 * 1024 * 1024) throw problem('The source response is too large.', 502);
    return JSON.parse(content);
  }
  async function principal() {
    if (provider === 'zendesk') {
      const data = (await request('/api/v2/users/me.json')).user;
      return { id: String(data.id), name: data.name || data.email };
    }
    if (provider === 'confluence') {
      const data = await request('/rest/api/user/current');
      return { id: data.accountId, name: data.displayName };
    }
    if (provider === 'servicenow') {
      const data = (await request(`${serviceNowPath}/me`)).result;
      if (!data?.id || data.permissionCheck !== 'KBKnowledge.canRead')
        throw problem(
          'The ServiceNow knowledge permission bridge is not installed or cannot verify access.',
          422,
        );
      return { id: data.id, name: data.name };
    }
    const data = await request('/v1/users/me');
    // Notion exposes an integration identity rather than effective end-user ACLs.
    return { id: data.id, name: data.name || 'Notion integration', isIntegration: true };
  }
  const groups = new Map();
  const pageTitle = (page) =>
    Object.values(page.properties || {})
      .flatMap((value) => value.title || [])
      .map((value) => value.plain_text || '')
      .join('') || 'Untitled';
  async function groupFor(item) {
    if (config.destination !== 'source') return undefined;
    if (provider === 'zendesk') {
      const key = String(item.section_id);
      if (!groups.has(key)) {
        const section = (
          await request(`/api/v2/help_center/sections/${encodeURIComponent(key)}.json`)
        ).section;
        const category = (
          await request(
            `/api/v2/help_center/categories/${encodeURIComponent(section.category_id)}.json`,
          )
        ).category;
        groups.set(key, { id: String(category.id), name: category.name });
      }
      return groups.get(key);
    }
    if (provider === 'confluence') {
      const key = String(item.spaceId);
      if (!groups.has(key)) {
        const space = await request(`/api/v2/spaces/${encodeURIComponent(key)}`);
        groups.set(key, { id: String(space.id), name: space.name });
      }
      return groups.get(key);
    }
    let page = item;
    for (let depth = 0; depth < 12; depth++) {
      if (groups.has(page.id)) return groups.get(page.id);
      if (page.parent?.database_id) {
        const database = await request(
          `/v1/databases/${encodeURIComponent(page.parent.database_id)}`,
        );
        const group = {
          id: database.id,
          name:
            (database.title || []).map((part) => part.plain_text || '').join('') ||
            'Untitled database',
        };
        groups.set(item.id, group);
        return group;
      }
      if (!page.parent?.page_id) {
        const group = { id: page.id, name: pageTitle(page) };
        groups.set(item.id, group);
        return group;
      }
      page = await request(`/v1/pages/${encodeURIComponent(page.parent.page_id)}`);
    }
    throw problem('Source page hierarchy exceeds the current import limit.', 422);
  }
  async function read(id) {
    if (provider === 'zendesk') {
      const item = (await request(`/api/v2/help_center/articles/${encodeURIComponent(id)}.json`))
        .article;
      return {
        id: String(item.id),
        knowledgeBase: await groupFor(item),
        title: item.title,
        text: text(item.body),
        url: item.html_url,
        updatedAt: item.updated_at,
      };
    }
    if (provider === 'confluence') {
      const item = await request(`/api/v2/pages/${encodeURIComponent(id)}?body-format=storage`);
      return {
        id: item.id,
        knowledgeBase: await groupFor(item),
        title: item.title,
        text: text(item.body?.storage?.value),
        url:
          tenant && /^[a-z0-9-]+$/.test(tenant)
            ? `https://${tenant}.atlassian.net/wiki${item._links?.webui || ''}`
            : `${base}/api/v2/pages/${encodeURIComponent(item.id)}`,
        updatedAt: item.version?.createdAt,
      };
    }
    if (provider === 'servicenow') {
      if (config.expectedPrincipalId && (await principal()).id !== config.expectedPrincipalId)
        throw problem('The ServiceNow user identity changed. Reconnect the source.', 403);
      if (!/^[a-f0-9]{32}$/.test(String(id))) throw problem('Invalid knowledge article ID.');
      const item = (await request(`${serviceNowPath}/articles/${id}`)).result;
      if (!item || item.id !== id || typeof item.text !== 'string')
        throw problem('Source access could not be verified.', 403);
      return {
        ...item,
        text: text(item.text),
        url: `${base}/kb_view.do?sys_kb_id=${encodeURIComponent(item.id)}`,
      };
    }
    const page = await request(`/v1/pages/${encodeURIComponent(id)}`);
    const parts = [];
    let blockCount = 0;
    async function children(blockId, depth = 0) {
      if (depth > 12) throw problem('Notion nesting exceeds the current import limit.', 422);
      let cursor;
      do {
        const data = await request(
          `/v1/blocks/${encodeURIComponent(blockId)}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        for (const block of data.results || []) {
          if (++blockCount > 2000)
            throw problem('Notion document exceeds the current block limit.', 422);
          parts.push(
            (block[block.type]?.rich_text || []).map((part) => part.plain_text || '').join(''),
          );
          if (block.has_children) await children(block.id, depth + 1);
        }
        cursor = data.has_more ? data.next_cursor : null;
      } while (cursor);
    }
    await children(id);
    return {
      id: page.id,
      knowledgeBase: await groupFor(page),
      title:
        Object.values(page.properties || {})
          .flatMap((value) => value.title || [])
          .map((value) => value.plain_text || '')
          .join('') || 'Untitled',
      text: parts.join('\n'),
      url: page.url,
      updatedAt: page.last_edited_time,
    };
  }
  async function* documents() {
    let next =
      provider === 'zendesk'
        ? '/api/v2/help_center/articles.json?per_page=100'
        : provider === 'confluence'
          ? '/api/v2/pages?limit=100'
          : provider === 'servicenow'
            ? `${serviceNowPath}/articles`
            : '/v1/search';
    let cursor;
    let count = 0;
    const seenPages = new Set();
    while (next) {
      const pageKey = `${next}|${cursor || ''}`;
      if (seenPages.has(pageKey) || seenPages.size >= 1000)
        throw problem('Source pagination repeated or exceeded the import limit.', 422);
      seenPages.add(pageKey);
      if (
        provider === 'servicenow' &&
        config.expectedPrincipalId &&
        (await principal()).id !== config.expectedPrincipalId
      )
        throw problem('The ServiceNow user identity changed.', 403);
      const data = await request(
        next,
        provider === 'notion'
          ? {
              method: 'POST',
              body: JSON.stringify({
                filter: { value: 'page', property: 'object' },
                page_size: 100,
                ...(cursor ? { start_cursor: cursor } : {}),
              }),
            }
          : {},
      );
      const items =
        provider === 'servicenow'
          ? data.result?.items || []
          : data.articles || data.results || data.result || [];
      for (const item of items) {
        if (++count > 5000)
          throw problem(
            'Import exceeds the current 5,000-document limit. The previous complete sync remains available.',
            422,
          );
        if (provider === 'servicenow') {
          if (
            !/^[a-f0-9]{32}$/.test(item.id) ||
            typeof item.title !== 'string' ||
            typeof item.text !== 'string'
          )
            throw problem('Invalid ServiceNow knowledge article.', 422);
          yield { ...item, text: text(item.text), url: `${base}/kb_view.do?sys_kb_id=${item.id}` };
        } else yield await read(item.id || item.sys_id);
      }
      if (provider === 'zendesk') next = data.next_page;
      else if (provider === 'confluence') {
        const link = data._links?.next;
        next = link ? (link.startsWith('/wiki/') ? link.slice(5) : link) : null;
      } else if (provider === 'notion') {
        cursor = data.has_more ? data.next_cursor : null;
        next = cursor ? '/v1/search' : null;
      } else {
        const cursor = data.result?.nextCursor;
        if (cursor && !/^[a-f0-9]{32}$/.test(cursor))
          throw problem('Invalid source pagination cursor.', 422);
        next = cursor ? `${serviceNowPath}/articles?cursor=${cursor}` : null;
      }
    }
  }
  return {
    principal,
    read,
    documents,
    async knowledgeBases() {
      if (provider !== 'servicenow') throw problem('Source base discovery is not available.', 422);
      if (config.expectedPrincipalId && (await principal()).id !== config.expectedPrincipalId)
        throw problem('The ServiceNow user identity changed.', 403);
      const bases = new Map();
      const deadline = Date.now() + 20000;
      let cursor = '';
      const seen = new Set();
      for (let page = 0; page < 50; page++) {
        if (Date.now() > deadline) throw problem('Source discovery exceeded its time limit.', 422);
        const data = (
          await request(`${serviceNowPath}/knowledge-bases${cursor ? '?cursor=' + cursor : ''}`)
        ).result;
        if (!Array.isArray(data?.items))
          throw problem('The knowledge-base bridge is unavailable.', 422);
        for (const item of data.items) {
          if (
            !/^[a-f0-9]{32}$/.test(item.id) ||
            typeof item.name !== 'string' ||
            item.name.length > 500
          )
            throw problem('Invalid source knowledge base.');
          bases.set(item.id, { id: item.id, name: item.name });
          if (bases.size > 5000) throw problem('Source base discovery exceeded its limit.');
        }
        if (!data.nextCursor)
          return [...bases.values()].sort((a, b) => a.name.localeCompare(b.name));
        if (!/^[a-f0-9]{32}$/.test(data.nextCursor) || seen.has(data.nextCursor))
          throw problem('Source pagination repeated.');
        cursor = data.nextCursor;
        seen.add(cursor);
      }
      throw problem('Source discovery exceeded its page limit.');
    },
    supportsUserPermissions: ['zendesk', 'confluence', 'servicenow'].includes(provider),
  };
}
