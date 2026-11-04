import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import sanitizeHtml from 'sanitize-html';
import { createSemanticService } from './semantic.js';
import { auditOperation } from './audit.js';

export function createAuthoredSemantic(store, fetcher = fetch) {
  const vectors = createSemanticService(store, fetcher, {
    collectionName: 'agentzuno_authored_knowledge_v1',
    chunkCollection: 'authoredKnowledgeChunks',
  });
  async function workspace(article) {
    const owner = await store
      .collection('users')
      .findOne({ id: article.ownerId }, { projection: { workspaceId: 1 } });
    return owner?.workspaceId && (!article.workspaceId || article.workspaceId === owner.workspaceId)
      ? owner.workspaceId
      : null;
  }
  async function process(job) {
    if (!vectors.enabled || !ObjectId.isValid(job.id)) return;
    const id = new ObjectId(job.id);
    const lease = randomUUID();
    const article = await store.collection('articles').findOneAndUpdate(
      {
        _id: id,
        ownerId: job.ownerId,
        $or: [
          { semanticLeaseUntil: { $exists: false } },
          { semanticLeaseUntil: { $lt: new Date() } },
        ],
      },
      { $set: { semanticLease: lease, semanticLeaseUntil: new Date(Date.now() + 600000) } },
      { returnDocument: 'after' },
    );
    if (!article) {
      const retirement = await store.collection('authoredSemanticRetirements').findOne({
        _id: job.id,
        ownerId: job.ownerId,
        workspaceId: job.workspaceId,
        status: 'Pending',
      });
      if (
        retirement &&
        !(await store.collection('articles').findOne({ _id: id, ownerId: job.ownerId }))
      ) {
        await vectors.retire(job.ownerId, job.workspaceId, job.id);
        await store
          .collection('authoredSemanticRetirements')
          .updateOne(
            { _id: job.id, generation: retirement.generation },
            { $set: { status: 'Retired', completedAt: new Date() } },
          );
      }
      return;
    }
    let claimedGeneration = article.semanticGeneration;
    try {
      const workspaceId = await workspace(article);
      if (!workspaceId || workspaceId !== job.workspaceId || article.sourceConnectionId) return;
      const generation = article.semanticGeneration || randomUUID();
      claimedGeneration = generation;
      if (!article.semanticGeneration) {
        const claimed = await store.collection('articles').updateOne(
          {
            _id: id,
            ownerId: job.ownerId,
            semanticLease: lease,
            updatedAt: article.updatedAt,
            semanticGeneration: { $exists: false },
          },
          { $set: { semanticGeneration: generation } },
        );
        if (!claimed.modifiedCount) return;
      }
      await auditOperation(
        store,
        { id: 'knowledge-indexer', ownerId: job.ownerId, workspaceId },
        'authored-knowledge-index',
        `/articles/${job.id}`,
        async () => {
          if (article.status !== 'Published') {
            await vectors.retire(job.ownerId, workspaceId, job.id);
          } else {
            const text = sanitizeHtml(article.body || '', {
              allowedTags: [],
              allowedAttributes: {},
            }).slice(0, 180000);
            await vectors.index(
              {
                ...article,
                workspaceId,
                connectionId: 'authored',
                knowledgeBaseId: article.base,
                runId: generation,
                text,
              },
              async () => {
                const renewed = await store.collection('articles').updateOne(
                  {
                    _id: id,
                    ownerId: job.ownerId,
                    semanticLease: lease,
                    semanticGeneration: generation,
                  },
                  { $set: { semanticLeaseUntil: new Date(Date.now() + 600000) } },
                );
                if (!renewed.matchedCount) throw new Error('Article indexing generation changed.');
              },
            );
          }
          const current = await store.collection('articles').findOne({
            _id: id,
            ownerId: job.ownerId,
            semanticLease: lease,
            semanticGeneration: generation,
          });
          if (!current || current.status !== article.status) {
            await vectors.retire(job.ownerId, workspaceId, job.id, current?.semanticGeneration);
            return;
          }
          await vectors.retire(
            job.ownerId,
            workspaceId,
            job.id,
            article.status === 'Published' ? generation : undefined,
          );
          await store.collection('articles').updateOne(
            {
              _id: id,
              ownerId: job.ownerId,
              semanticLease: lease,
              semanticGeneration: generation,
            },
            {
              $set: {
                semanticStatus: article.status === 'Published' ? 'Ready' : 'Retired',
                semanticIndexedGeneration: generation,
                semanticIndexedAt: new Date(),
              },
              $unset: { semanticRetryAt: '' },
            },
          );
        },
      );
    } catch (error) {
      await store.collection('articles').updateOne(
        {
          _id: id,
          semanticLease: lease,
          ...(claimedGeneration ? { semanticGeneration: claimedGeneration } : {}),
        },
        {
          $set: {
            semanticStatus: 'Needs attention',
            semanticRetryAt: new Date(Date.now() + 300000),
          },
        },
      );
      throw new Error('Local knowledge indexing could not complete.');
    } finally {
      await store
        .collection('articles')
        .updateOne(
          { _id: id, semanticLease: lease },
          { $unset: { semanticLease: '', semanticLeaseUntil: '' } },
        );
    }
  }
  async function pending() {
    if (!vectors.enabled) return [];
    const articles = await store
      .collection('articles')
      .find({
        sourceConnectionId: { $exists: false },
        $or: [
          { semanticStatus: { $exists: false } },
          { semanticStatus: 'Pending' },
          { semanticStatus: 'Needs attention', semanticRetryAt: { $lte: new Date() } },
        ],
      })
      .sort({ _id: 1 })
      .limit(50)
      .toArray();
    const jobs = [];
    for (const article of articles) {
      const workspaceId = await workspace(article);
      if (workspaceId)
        jobs.push({
          _id: article._id,
          ownerId: article.ownerId,
          workspaceId,
          runId: article.semanticGeneration || 'backfill',
          sourceKind: 'authored',
        });
    }
    const retirements = await store
      .collection('authoredSemanticRetirements')
      .find({ status: 'Pending' })
      .limit(50)
      .toArray();
    return [
      ...jobs,
      ...retirements.map((item) => ({
        ...item,
        _id: new ObjectId(item._id),
        runId: item.generation,
        sourceKind: 'authored',
      })),
    ];
  }
  return { enabled: vectors.enabled, process, pending, candidates: vectors.candidates };
}
