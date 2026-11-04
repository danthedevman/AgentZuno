import { createAuthoredSemantic } from './authoredSemantic.js';
import { createInvitationDelivery } from './invitations.js';
import { createWorkflowExecution } from './workflowExecution.js';
import { createHelpdeskSlack } from './helpdeskSlack.js';
import { createHelpdeskEmail } from './helpdeskEmail.js';
import { createSemanticService } from './semantic.js';
import { ObjectId } from 'mongodb';
import { Worker, Queue } from 'bullmq';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { createIntegrationStore } from './integrationStore.js';
import { createIntegrationService } from './integrations.js';
import { createChatService } from './chat.js';
import { createQueues, queueNames } from './queues.js';

if (!process.env.REDIS_URL || !process.env.MONGODB_URI)
  throw new Error('The worker requires REDIS_URL and MONGODB_URI.');
const store = createIntegrationStore();
await store.ready();
const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', () => console.error('Worker Redis connection unavailable.'));
const queues = createQueues();
const integrations = createIntegrationService(store, async () => {
  throw new Error('Interactive setup is API-only.');
});
const deliverInvitations = createInvitationDelivery(store);
const chats = createChatService(store, queues.chat);
const workflowExecution = createWorkflowExecution(store);
const workflowWorker = new Worker(
  queueNames.workflow,
  (job) => workflowExecution.process(job.data.id),
  { connection, concurrency: 2 },
);
const scheduler = new Queue(queueNames.scheduler, { connection });
await scheduler.upsertJobScheduler(
  'due-connections',
  { every: 30000 },
  { name: 'dispatch', data: {}, opts: { removeOnComplete: 10, removeOnFail: 100 } },
);
const syncWorker = new Worker(
  queueNames.sync,
  async (job) => {
    const source = await store.connection(job.data.ownerId, job.data.id);
    if (!source || source.status !== 'Connected' || source.authType === 'export') return;
    const lockKey = `agentzuno-provider-${source.provider}`;
    const lease = randomUUID();
    if (!(await connection.set(lockKey, lease, 'PX', 600000, 'NX')))
      throw new Error('Provider concurrency limit reached.');
    const renew = setInterval(
      () =>
        connection
          .eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], 600000) end return 0",
            1,
            lockKey,
            lease,
          )
          .catch(() => {}),
      30000,
    );
    try {
      await integrations.sync(source);
    } catch (error) {
      // Queue failures must never persist raw provider errors or credentials in Redis.
      throw Object.assign(new Error('Source import failed. Review the connection status.'), {
        retryAfter: error.retryAfter,
      });
    } finally {
      clearInterval(renew);
      await connection.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
        1,
        lockKey,
        lease,
      );
    }
  },
  {
    connection,
    concurrency: 4,
    settings: {
      backoffStrategy: (attempts, type, error) =>
        Math.max(
          Number(error.retryAfter) || 0,
          Math.round(30000 * 2 ** (attempts - 1) * (0.75 + Math.random() * 0.25)),
        ),
    },
  },
);
const chatWorker = new Worker(queueNames.chat, (job) => chats.process(job.data), {
  connection,
  concurrency: 4,
});
const slack = createHelpdeskSlack(store, chats, queues.slack);
const slackWorker = new Worker(
  queueNames.slack,
  async (job) => {
    if (!ObjectId.isValid(job.data.id)) return;
    const source = await store.collection('helpdeskChannels').findOne({
      _id: new ObjectId(job.data.id),
      ownerId: job.data.ownerId,
      workspaceId: job.data.workspaceId,
      provider: 'slack',
      'bot.enabled': true,
    });
    if (source) await slack.process(source);
  },
  { connection, concurrency: 2 },
);
chatWorker.on('completed', async (job) => {
  try {
    const chat = await store.collection('chats').findOne({ _id: new ObjectId(job.data.id) });
    if (chat?.slackSourceId) {
      const source = await store.collection('helpdeskChannels').findOne({
        _id: new ObjectId(chat.slackSourceId),
        ownerId: chat.providerOwnerId,
        workspaceId: chat.workspaceId,
        'bot.enabled': true,
      });
      if (source) await queues.slack(source);
    }
  } catch {
    console.error('Slack reply dispatch will be retried by the scheduler.');
  }
});
const email = createHelpdeskEmail(store, chats);
const emailWorker = new Worker(
  queueNames.email,
  async (job) => {
    if (!ObjectId.isValid(job.data.id)) return;
    const source = await store.collection('helpdeskChannels').findOne({
      _id: new ObjectId(job.data.id),
      ownerId: job.data.ownerId,
      workspaceId: job.data.workspaceId,
      'email.enabled': true,
    });
    if (source) await email.process(source);
  },
  { connection, concurrency: 1 },
);
const semantic = createSemanticService(store);
const authoredSemantic = createAuthoredSemantic(store);
const vectorWorker = new Worker(
  queueNames.vector,
  async (job) => {
    if (job.data.sourceKind === 'authored') return authoredSemantic.process(job.data);
    const filter = {
      _id: new ObjectId(job.data.id),
      ownerId: job.data.ownerId,
      workspaceId: job.data.workspaceId,
      runId: job.data.runId,
      deletedAt: { $exists: false },
      $or: [
        { semanticLeaseUntil: { $exists: false } },
        { semanticLeaseUntil: { $lt: new Date() } },
      ],
    };
    const document = await store
      .collection('knowledgeDocuments')
      .findOneAndUpdate(
        filter,
        { $set: { semanticLeaseUntil: new Date(Date.now() + 600000) } },
        { returnDocument: 'after' },
      );
    if (!document) return;
    try {
      const source = await store.connection(document.ownerId, document.connectionId);
      if (source?.status !== 'Connected' || source.sync?.activeRunId !== document.runId) return;
      const chunkCount = await semantic.index(document);
      await store
        .collection('knowledgeDocuments')
        .updateOne(
          { _id: document._id, runId: document.runId, deletedAt: { $exists: false } },
          { $set: { semanticStatus: 'Ready', chunkCount, semanticIndexedAt: new Date() } },
        );
    } catch {
      await store.collection('knowledgeDocuments').updateOne(
        { _id: document._id },
        {
          $set: {
            semanticStatus: 'Needs attention',
            semanticRetryAt: new Date(Date.now() + 300000),
          },
        },
      );
      throw new Error('Vector indexing failed. Check local Ollama model and Qdrant.');
    } finally {
      await store
        .collection('knowledgeDocuments')
        .updateOne({ _id: document._id }, { $unset: { semanticLeaseUntil: '' } });
    }
  },
  { connection, concurrency: 1 },
);
const schedulerWorker = new Worker(
  queueNames.scheduler,
  async () => {
    await deliverInvitations();
    for (const run of await workflowExecution.recover()) await queues.workflow(run);
    await connection.set('agentzuno-worker-heartbeat', String(Date.now()), 'EX', 120);
    const bots = await store
      .collection('helpdeskChannels')
      .find({
        provider: 'slack',
        'bot.enabled': true,
        $or: [{ 'bot.nextAt': { $exists: false } }, { 'bot.nextAt': { $lte: new Date() } }],
      })
      .limit(100)
      .toArray();
    for (const bot of bots) await queues.slack(bot);
    const inboxes = await store
      .collection('helpdeskChannels')
      .find({
        provider: { $in: ['gmail', 'outlook'] },
        'email.enabled': true,
        $or: [{ 'email.nextAt': { $exists: false } }, { 'email.nextAt': { $lte: new Date() } }],
      })
      .limit(100)
      .toArray();
    for (const inbox of inboxes) await queues.email(inbox);
    const due = await store
      .collection('sourceConnections')
      .find({
        status: 'Connected',
        authType: { $ne: 'export' },
        'sync.nextAt': { $lte: new Date() },
        $or: [
          { 'sync.leaseUntil': { $exists: false } },
          { 'sync.leaseUntil': { $lt: new Date() } },
        ],
      })
      .sort({ 'sync.nextAt': 1 })
      .limit(100)
      .toArray();
    for (const source of due) await queues.sync(source);
    if (semantic.enabled) {
      await semantic.cleanup().catch(() => {});
      for (const article of await authoredSemantic.pending()) await queues.vector(article);
      const documents = await store
        .collection('knowledgeDocuments')
        .find({
          deletedAt: { $exists: false },
          $or: [
            { semanticStatus: 'Pending' },
            { semanticStatus: { $exists: false } },
            { semanticStatus: 'Needs attention', semanticRetryAt: { $lte: new Date() } },
          ],
        })
        .limit(100)
        .toArray();
      for (const document of documents) {
        const source = await store.connection(document.ownerId, document.connectionId);
        if (source?.status === 'Connected' && source.sync?.activeRunId === document.runId)
          await queues.vector(document);
      }
    }
    const pending = await store
      .collection('chats')
      .find({
        $or: [{ status: 'queued' }, { status: 'responding', leaseUntil: { $lt: new Date() } }],
      })
      .limit(100)
      .toArray();
    for (const chat of pending)
      await queues.chat({
        id: chat._id.toHexString(),
        ownerId: chat.ownerId,
        workspaceId: chat.workspaceId,
        responseId: chat.responseId,
      });
  },
  { connection, concurrency: 1 },
);
for (const worker of [syncWorker, chatWorker, schedulerWorker, vectorWorker, emailWorker])
  worker.on('error', () => console.error('Background worker error; job state remains in Redis.'));
chatWorker.on('failed', async (job) => {
  if (!job || (await job.getState()) !== 'failed') return;
  const { ObjectId } = await import('mongodb');
  if (!ObjectId.isValid(job.data.id)) return;
  await store
    .collection('chats')
    .updateOne(
      {
        _id: new ObjectId(job.data.id),
        ownerId: job.data.ownerId,
        workspaceId: job.data.workspaceId,
        responseId: job.data.responseId,
        status: { $in: ['queued', 'responding'] },
      },
      {
        $set: {
          status: 'failed',
          'messages.$[reply].status': 'failed',
          'messages.$[reply].error':
            'The background worker could not complete this response. Please retry.',
        },
        $unset: { lease: '', leaseUntil: '' },
      },
      { arrayFilters: [{ 'reply.id': job.data.responseId }] },
    )
    .catch(() => {});
});
console.log('AgentZuno BullMQ worker ready.');
async function close() {
  await Promise.all([
    syncWorker.close(),
    chatWorker.close(),
    schedulerWorker.close(),
    vectorWorker.close(),
    emailWorker.close(),
    slackWorker.close(),
    workflowWorker.close(),
  ]);
  await scheduler.close();
  await queues.close();
  await store.close();
  connection.disconnect();
}
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => close().then(() => process.exit(0)));
