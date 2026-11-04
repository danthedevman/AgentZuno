import { Queue } from 'bullmq';
import Redis from 'ioredis';

export const queueNames = {
  sync: 'agentzuno-sync',
  vector: 'agentzuno-vector',
  email: 'agentzuno-email',
  slack: 'agentzuno-slack',
  workflow: 'agentzuno-workflow',
  chat: 'agentzuno-chat',
  scheduler: 'agentzuno-scheduler',
};
export function createQueues() {
  if (!process.env.REDIS_URL)
    return {
      sync: async () => {
        throw Object.assign(
          new Error('Redis is not configured. Start Redis and the worker to schedule imports.'),
          { status: 503, publicMessage: 'Redis is not configured. Start Redis and the worker.' },
        );
      },
      slack: async () => {
        throw new Error('Redis is not configured.');
      },
      workflow: async () => {
        throw new Error('Redis is not configured.');
      },
      email: async () => {
        throw new Error('Redis is not configured.');
      },
      chat: async () => {
        throw new Error('Redis is not configured.');
      },
      close: async () => {},
    };
  const connection = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  connection.on('error', () => {});
  const options = {
    connection,
    defaultJobOptions: {
      removeOnComplete: { age: 86400, count: 1000 },
      removeOnFail: { age: 604800, count: 1000 },
    },
  };
  const sync = new Queue(queueNames.sync, options);
  const vector = new Queue(queueNames.vector, options);
  vector.on('error', () => {});
  const slack = new Queue(queueNames.slack, options);
  slack.on('error', () => {});
  const email = new Queue(queueNames.email, options);
  email.on('error', () => {});
  const workflow = new Queue(queueNames.workflow, options);
  workflow.on('error', () => {});
  const chat = new Queue(queueNames.chat, options);
  sync.on('error', () => {});
  chat.on('error', () => {});
  return {
    sync: async (item, key) =>
      sync.add(
        'import',
        { id: item._id.toHexString(), ownerId: item.ownerId },
        {
          jobId: key || `sync-${item._id}-${item.sync?.nextAt?.getTime() || 0}`,
          attempts: 5,
          backoff: { type: 'provider' },
        },
      ),
    vector: async (item) =>
      vector.add(
        'index',
        {
          id: item._id.toHexString(),
          ownerId: item.ownerId,
          workspaceId: item.workspaceId,
          runId: item.runId,
          ...(item.sourceKind ? { sourceKind: item.sourceKind } : {}),
        },
        {
          jobId: `vector-${item.sourceKind || 'imported'}-${item._id}-${item.runId}-${Math.floor(Date.now() / 300000)}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30000 },
        },
      ),
    slack: async (item) =>
      slack.add(
        'message',
        { id: item._id.toHexString(), ownerId: item.ownerId, workspaceId: item.workspaceId },
        {
          jobId: `slack-${item._id}-${Date.now()}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30000, jitter: 0.25 },
        },
      ),
    email: async (item) =>
      email.add(
        'inbox',
        { id: item._id.toHexString(), ownerId: item.ownerId, workspaceId: item.workspaceId },
        {
          jobId: `email-${item._id}-${Math.floor(Date.now() / 60000)}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000, jitter: 0.25 },
        },
      ),
    workflow: async (item) =>
      workflow.add(
        'execute',
        { id: String(item._id), ownerId: item.ownerId, workspaceId: item.workspaceId },
        { jobId: `workflow-${item._id}-${Math.floor(Date.now() / 30000)}`, attempts: 1 },
      ),
    chat: async (item) =>
      chat.add('respond', item, {
        jobId: `chat-${item.id}-${item.responseId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 30000, jitter: 0.25 },
      }),
    close: async () => {
      await Promise.all([
        sync.close(),
        chat.close(),
        vector.close(),
        email.close(),
        slack.close(),
        workflow.close(),
      ]);
      connection.disconnect();
    },
  };
}
