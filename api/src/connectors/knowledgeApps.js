import {
  basic,
  createSourceHttp,
  paginated,
  plainText,
  segment,
  sourceError,
  tenantHost,
} from './http.js';
const apiKey = [{ id: 'api-key', label: 'API key', credentialLabel: 'API key' }];
const field = (name, label, pattern = '^[a-zA-Z0-9_-]{1,200}$') => ({
  name,
  label,
  required: true,
  pattern,
});
const regionField = {
  name: 'region',
  label: 'Region',
  defaultValue: 'eu',
  options: [
    { value: 'eu', label: 'Europe' },
    { value: 'us', label: 'United States' },
    { value: 'ca', label: 'Canada' },
  ],
};

export const knowledgeAdapters = {
  document360: {
    authenticationMethods: apiKey,
    connectionFields: [
      field('projectId', 'Project ID', '^[a-fA-F0-9-]{36}$'),
      field('sourceWorkspaceId', 'Source workspace ID', '^[a-fA-F0-9-]{36}$'),
      regionField,
    ],
    docsUrl: 'https://apidocs.document360.com/apidocs/introduction',
    create(config, credential, fetcher) {
      const host = {
        eu: 'https://apihub.document360.io',
        us: 'https://apihub.us.document360.io',
        ca: 'https://apihub.ca.document360.io',
      }[config.region];
      if (!host) throw sourceError('Choose a Document360 region.');
      const root = `/v3/projects/${segment(config.projectId)}`;
      const request = createSourceHttp(host, { 'X-API-Key': credential }, fetcher);
      let project;
      async function principal() {
        project = (await request(root)).data.data;
        if (!project?.id || !project.name)
          throw sourceError('The Document360 project could not be verified.');
        await request(`${root}/workspaces/${segment(config.sourceWorkspaceId)}`);
        return { id: project.id, name: project.name, isIntegration: true };
      }
      async function read(id) {
        project ||= (await request(root)).data.data;
        const item = (
          await request(`${root}/articles/${segment(id)}?published=true&content_mode=display`)
        ).data.data;
        if (!item?.id || item.status !== 'published' || item.is_archived)
          throw sourceError('The article is not published or readable.');
        return {
          id: item.id,
          title: item.title,
          text: plainText(item.html_content || item.content),
          updatedAt: item.modified_at,
          publicationState: item.status,
          knowledgeBase: { id: project.id, name: project.name },
        };
      }
      async function* documents() {
        await principal();
        const path = `${root}/workspaces/${segment(config.sourceWorkspaceId)}/articles?page_size=100`;
        for await (const item of paginated(
          request,
          path,
          (data) => data.data,
          ({ data }, page, items) =>
            data.pagination?.next_cursor
              ? `${path}&cursor=${segment(data.pagination.next_cursor)}`
              : data.pagination?.has_more
                ? `${path}&page=${page + 1}`
                : null,
        )) {
          if (item.public_version > 0 || item.status === 'published') yield await read(item.id);
        }
      }
      return { principal, read, documents };
    },
  },
  freshdesk: {
    authenticationMethods: apiKey,
    connectionFields: [field('tenant', 'Freshdesk subdomain', '^[a-z0-9][a-z0-9-]{0,62}$')],
    docsUrl: 'https://developer.freshdesk.com/api/',
    create(config, credential, fetcher) {
      const base = tenantHost(config.tenant, 'freshdesk.com');
      const request = createSourceHttp(base, { Authorization: basic(credential, 'X') }, fetcher);
      async function principal() {
        const item = (await request('/api/v2/agents/me')).data;
        if (!item.id) throw sourceError('The Freshdesk identity could not be verified.');
        return {
          id: String(item.id),
          name: item.contact?.name || config.tenant,
          isIntegration: true,
        };
      }
      async function read(id, category) {
        const item = (await request(`/api/v2/solutions/articles/${segment(id)}`)).data;
        if (item.status !== 2) throw sourceError('The article is not published.');
        return {
          id: String(item.id),
          title: item.title,
          text: plainText(item.description),
          updatedAt: item.updated_at,
          publicationState: 'published',
          knowledgeBase: category && { id: String(category.id), name: category.name },
          url: `${base}/support/solutions/articles/${segment(item.id)}`,
        };
      }
      const pages = (path) =>
        paginated(
          request,
          `${path}?per_page=100&page=1`,
          (data) => data,
          (response, page, items) =>
            items.length === 100 ? `${path}?per_page=100&page=${page + 1}` : null,
        );
      async function* documents() {
        for await (const category of pages('/api/v2/solutions/categories'))
          for await (const folder of pages(
            `/api/v2/solutions/categories/${segment(category.id)}/folders`,
          ))
            for await (const item of pages(
              `/api/v2/solutions/folders/${segment(folder.id)}/articles`,
            ))
              if (item.status === 2) yield await read(item.id, category);
      }
      return { principal, read, documents };
    },
  },
  'help-scout': {
    authenticationMethods: apiKey,
    connectionFields: [],
    docsUrl: 'https://developer.helpscout.com/docs-api/',
    create(config, credential, fetcher) {
      const request = createSourceHttp(
        'https://docsapi.helpscout.net',
        { Authorization: basic(credential, 'X') },
        fetcher,
      );
      const groups = new Map();
      async function principal() {
        const data = (await request('/v1/collections?page=1')).data;
        if (!Array.isArray(data.collections?.items))
          throw sourceError('Help Scout Docs access could not be verified.');
        return { id: 'helpscout-docs', name: 'Help Scout Docs', isIntegration: true };
      }
      async function read(id) {
        const item = (await request(`/v1/articles/${segment(id)}`)).data.article;
        if (item?.status !== 'published') throw sourceError('The article is not published.');
        if (!groups.has(item.collectionId)) {
          const data = (await request(`/v1/collections/${segment(item.collectionId)}`)).data
            .collection;
          groups.set(item.collectionId, { id: data.id, name: data.name });
        }
        return {
          id: item.id,
          title: item.name,
          text: plainText(item.text),
          updatedAt: item.updatedAt,
          publicationState: item.status,
          url: item.publicUrl,
          knowledgeBase: groups.get(item.collectionId),
        };
      }
      const pages = (path, key) =>
        paginated(
          request,
          `${path}?page=1`,
          (data) => data[key]?.items,
          ({ data }, page) => (data[key].pages > page ? `${path}?page=${page + 1}` : null),
        );
      async function* documents() {
        for await (const collection of pages('/v1/collections', 'collections')) {
          groups.set(collection.id, { id: collection.id, name: collection.name });
          for await (const article of pages(
            `/v1/collections/${segment(collection.id)}/articles`,
            'articles',
          ))
            if (article.status === 'published') yield await read(article.id);
        }
      }
      return { principal, read, documents };
    },
  },
  intercom: {
    authenticationMethods: [
      { id: 'oauth', label: 'OAuth access token', credentialLabel: 'Access token' },
      ...apiKey,
    ],
    connectionFields: [
      {
        ...regionField,
        options: [
          { value: 'us', label: 'United States' },
          { value: 'eu', label: 'Europe' },
          { value: 'au', label: 'Australia' },
        ],
        defaultValue: 'us',
      },
    ],
    docsUrl:
      'https://developers.intercom.com/docs/references/rest-api/api.intercom.io/articles/listarticles',
    create(config, credential, fetcher) {
      const base = {
        us: 'https://api.intercom.io',
        eu: 'https://api.eu.intercom.io',
        au: 'https://api.au.intercom.io',
      }[config.region];
      if (!base) throw sourceError('Choose an Intercom region.');
      const request = createSourceHttp(
        base,
        { Authorization: `Bearer ${credential}`, 'Intercom-Version': '2.17' },
        fetcher,
      );
      let account;
      async function principal() {
        account = (await request('/me')).data;
        if (!account.id) throw sourceError('The Intercom identity could not be verified.');
        return { id: String(account.id), name: account.name || 'Intercom', isIntegration: true };
      }
      async function read(id) {
        account ||= (await request('/me')).data;
        const item = (await request(`/articles/${segment(id)}`)).data;
        if (item.state !== 'published') throw sourceError('The article is not published.');
        return {
          id: String(item.id),
          title: item.title,
          text: plainText(item.body),
          updatedAt: new Date(item.updated_at * 1000).toISOString(),
          publicationState: item.state,
          url: item.url,
          knowledgeBase: {
            id: String(account.app?.id_code || account.id),
            name: account.app?.name || account.name || 'Intercom',
          },
        };
      }
      async function* documents() {
        for await (const item of paginated(
          request,
          '/articles?per_page=100&page=1',
          (data) => data.data,
          ({ data }, page) => (data.pages?.next ? `/articles?per_page=100&page=${page + 1}` : null),
        ))
          if (item.state === 'published') yield await read(item.id);
      }
      return { principal, read, documents };
    },
  },
  helpjuice: {
    authenticationMethods: apiKey,
    connectionFields: [field('tenant', 'Helpjuice subdomain', '^[a-z0-9][a-z0-9-]{0,62}$')],
    docsUrl: 'https://help.helpjuice.com/api-v3/using-api-v3',
    create(config, credential, fetcher) {
      const base = tenantHost(config.tenant, 'helpjuice.com');
      const request = createSourceHttp(base, { Authorization: credential }, fetcher);
      async function principal() {
        await request('/api/v3/settings');
        return { id: config.tenant, name: config.tenant, isIntegration: true };
      }
      async function read(id) {
        const item = (await request(`/api/v3/articles/${segment(id)}`)).data.article;
        if (!item?.published) throw sourceError('The article is not published.');
        return {
          id: String(item.id),
          title: item.name,
          text: plainText(
            (item.answer || []).map((part) => part.body_txt || part.body || '').join('\n'),
          ),
          updatedAt: item.updated_at,
          publicationState: 'published',
          url: item.url,
          knowledgeBase: { id: config.tenant, name: config.tenant },
        };
      }
      async function* documents() {
        for await (const item of paginated(
          request,
          '/api/v3/articles?page=1&limit=100',
          (data) => data.articles,
          ({ data }, page, items) =>
            items.length === 100 ? `/api/v3/articles?page=${page + 1}&limit=100` : null,
        ))
          if (item.published) yield await read(item.id);
      }
      return { principal, read, documents };
    },
  },
};
