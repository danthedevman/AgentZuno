import { createKnowledgeTopics } from './knowledgeTopics.js';
import { requireCompatibleDemoReferences } from '../demo/demoReferences.js';
import { ObjectId } from 'mongodb';

const failure = (message, status = 400) =>
  Object.assign(new Error(message), { status, publicMessage: message });
const utcDay = (date) => date.toISOString().slice(0, 10);

export function createKnowledgeAnalytics(store, loadWorkspace, integrationService) {
  async function overview(user, inputDays) {
    const days = Number(inputDays || 30);
    if (![7, 30, 90].includes(days)) throw failure('Choose a 7, 30, or 90 day reporting period.');
    const workspace = await loadWorkspace(user);
    const now = new Date();
    const since = new Date(now);
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - days + 1);
    const articles = workspace.articles || [];
    const connections = user && !user.isDemo ? await store.connections(user.id) : [];
    const currentConnections = connections.filter(
      (item) => item.status === 'Connected' && item.sync?.activeRunId,
    );
    const generations = currentConnections.map((item) => ({
      connectionId: item._id.toHexString(),
      runId: item.sync.activeRunId,
    }));
    const filter =
      user && !user.isDemo
        ? { ownerId: user.id, workspaceId: user.workspaceId, at: { $gte: since, $lte: now } }
        : null;
    let views = [],
      queryStats = {},
      imported = [];
    if (filter) {
      [views, queryStats, imported] = await Promise.all([
        store
          .collection('knowledgeViews')
          .aggregate([
            { $match: filter },
            {
              $group: {
                _id: {
                  documentId: '$documentId',
                  kind: '$kind',
                  day: { $dateToString: { format: '%Y-%m-%d', date: '$at', timezone: 'UTC' } },
                },
                count: { $sum: 1 },
              },
            },
          ])
          .toArray(),
        store
          .collection('knowledgeAudit')
          .aggregate([
            { $match: { ...filter, agentId: { $ne: 'workspace-ui' } } },
            {
              $facet: {
                daily: [
                  {
                    $group: {
                      _id: { $dateToString: { format: '%Y-%m-%d', date: '$at', timezone: 'UTC' } },
                      count: { $sum: 1 },
                    },
                  },
                ],
                agents: [{ $group: { _id: '$agentId', count: { $sum: 1 } } }],
                references: [
                  { $unwind: '$references' },
                  {
                    $group: {
                      _id: { documentId: '$references.documentId', kind: '$references.kind' },
                      count: { $sum: 1 },
                    },
                  },
                  { $sort: { count: -1 } },
                  { $limit: 100 },
                ],
                totals: [
                  {
                    $group: {
                      _id: null,
                      count: { $sum: 1 },
                      answered: {
                        $sum: {
                          $cond: [{ $gt: [{ $size: { $ifNull: ['$resultIds', []] } }, 0] }, 1, 0],
                        },
                      },
                      averageDurationMs: { $avg: '$durationMs' },
                    },
                  },
                ],
              },
            },
          ])
          .next()
          .then((result) => result || {}),
        generations.length
          ? store
              .collection('knowledgeDocuments')
              .aggregate([
                {
                  $match: {
                    ownerId: user.id,
                    workspaceId: user.workspaceId,
                    deletedAt: { $exists: false },
                    $or: generations,
                  },
                },
                {
                  $group: {
                    _id: '$knowledgeBaseId',
                    count: { $sum: 1 },
                    stale: {
                      $sum: {
                        $cond: [
                          {
                            $lt: [
                              {
                                $convert: {
                                  input: '$updatedAt',
                                  to: 'date',
                                  onError: now,
                                  onNull: now,
                                },
                              },
                              new Date(now.getTime() - 90 * 86400000),
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                    },
                  },
                },
              ])
              .toArray()
          : [],
      ]);
    }
    const daily = Array.from({ length: days }, (_, index) => {
      const date = new Date(since);
      date.setUTCDate(date.getUTCDate() + index);
      return { label: utcDay(date), views: 0, queries: 0 };
    });
    const byDay = new Map(daily.map((item) => [item.label, item]));
    const viewCounts = new Map();
    for (const item of views) {
      const key = `${item._id.kind}:${item._id.documentId}`;
      viewCounts.set(key, (viewCounts.get(key) || 0) + item.count);
      if (byDay.has(item._id.day)) byDay.get(item._id.day).views += item.count;
    }
    const referenceCounts = new Map(
      (queryStats.references || []).map((item) => [
        `${item._id.kind}:${item._id.documentId}`,
        item.count,
      ]),
    );
    const agentCounts = new Map((queryStats.agents || []).map((item) => [item._id, item.count]));
    const totals = queryStats.totals?.[0] || { count: 0, answered: 0 };
    for (const item of queryStats.daily || []) {
      if (byDay.has(item._id)) byDay.get(item._id).queries = item.count;
    }
    const titleCache = new Map(
      articles.map((item) => [
        `article:${item.id}`,
        { id: item.id, title: item.title, href: `/workspace/articles/${item.id}` },
      ]),
    );
    async function rank(counts) {
      const ranked = [];
      const started = Date.now();
      for (const [key, value] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
        if (Date.now() - started > 15000) break;
        if (!titleCache.has(key) && key.startsWith('source:') && user) {
          const id = key.slice(7);
          try {
            const item = await integrationService.readDocument(user, id);
            titleCache.set(key, {
              id,
              title: item.title,
              href: `/workspace/knowledge/source/${id}`,
            });
          } catch {
            continue;
          }
        }
        const item = titleCache.get(key);
        if (item) ranked.push({ ...item, label: item.title, value });
        if (ranked.length >= 10) break;
      }
      return ranked;
    }
    const [mostViewed, mostReferenced] = await Promise.all([
      rank(viewCounts),
      rank(referenceCounts),
    ]);
    const coverage = (workspace.knowledgeBases || []).map((base) => ({
      id: base.id,
      label: base.name,
      value:
        articles.filter((item) => item.base === base.id).length +
        (imported.find((item) => item._id === base.id)?.count || 0),
    }));
    const states = new Map();
    for (const article of articles) {
      const state = article.publicationState || article.publishState || article.status || 'Saved';
      states.set(state, (states.get(state) || 0) + 1);
    }
    const importedCount = imported.reduce((sum, item) => sum + item.count, 0);
    if (importedCount) states.set('Imported snapshots', importedCount);
    const staleNative = articles.filter(
      (article) =>
        article.updatedAt && Date.parse(article.updatedAt) < now.getTime() - 90 * 86400000,
    ).length;
    return {
      days,
      since,
      asOf: now,
      isExample: !user || !!user.isDemo,
      summary: {
        knowledgeBases: coverage.length,
        articles: articles.length + importedCount,
        importedArticles: importedCount,
        views: views.reduce((sum, item) => sum + item.count, 0),
        agentQueries: totals.count,
        retrievalRate: totals.count ? Math.round((totals.answered / totals.count) * 100) : 0,
        emptyQueries: totals.count - totals.answered,
        averageDurationMs: Math.round(totals.averageDurationMs || 0),
        emptyBases: coverage.filter((base) => !base.value).length,
        staleArticles: staleNative + imported.reduce((sum, item) => sum + item.stale, 0),
        topics: workspace.topics?.length || 0,
      },
      daily,
      mostViewed,
      mostReferenced,
      coverage,
      articleStates: [...states.entries()].map(([label, value]) => ({ label, value })),
      connections: connections.map((item) => ({
        id: item._id.toHexString(),
        label: item.name,
        status: item.status,
        syncStatus: item.sync?.status || 'Not synced',
        lastAt: item.sync?.lastAt || null,
        documentCount: item.sync?.documentCount || 0,
      })),
    };
  }
  async function view(user, input) {
    if (!user || user.isDemo) throw failure('Sign in to record workspace usage.', 401);
    if (
      !['article', 'source'].includes(input.kind) ||
      typeof input.documentId !== 'string' ||
      typeof input.eventId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(input.eventId)
    )
      throw failure('Invalid article view event.');
    const workspace = await loadWorkspace(user);
    if (input.kind === 'article') {
      if (!workspace.articles.some((item) => item.id === input.documentId))
        throw failure('Article not found.', 404);
    } else await integrationService.readDocument(user, input.documentId);
    await store.collection('knowledgeViews').updateOne(
      { ownerId: user.id, workspaceId: user.workspaceId, eventId: input.eventId },
      {
        $setOnInsert: {
          ownerId: user.id,
          workspaceId: user.workspaceId,
          documentId: input.documentId,
          kind: input.kind,
          eventId: input.eventId,
          at: new Date(),
        },
      },
      { upsert: true },
    );
  }
  const topic = createKnowledgeTopics(store, loadWorkspace);
  return { overview, view, topic };
}
