import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { Worker, QueueEvents, Queue } from 'bullmq';
import Redis from 'ioredis';
import { createQueues, queueNames } from '../src/identity/queues.js';

const redisUrl = process.env.TEST_REDIS_URL;
test(
  'BullMQ retains queued imports across producer restarts and deduplicates dispatch',
  { skip: !redisUrl },
  async () => {
    const previous = process.env.REDIS_URL;
    process.env.REDIS_URL = redisUrl;
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    connection.on('error', () => {});
    const observer = new Queue(queueNames.sync, { connection });
    const events = new QueueEvents(queueNames.sync, { connection });
    await events.waitUntilReady();
    let producer = createQueues();
    let worker;
    const key = `test-${randomUUID()}`;
    const source = {
      _id: new ObjectId(),
      ownerId: `test-owner-${randomUUID()}`,
      sync: { nextAt: new Date() },
    };
    try {
      const first = await producer.sync(source, key);
      await producer.close();
      producer = createQueues();
      const duplicate = await producer.sync(source, key);
      assert.equal(first.id, duplicate.id);
      assert.deepEqual((await observer.getJob(key)).data, {
        id: source._id.toHexString(),
        ownerId: source.ownerId,
      });
      let runs = 0;
      worker = new Worker(
        queueNames.sync,
        async (job) => {
          if (job.id !== key) return;
          runs++;
          if (runs === 1) throw new Error('Transient fixture failure');
          return 'complete';
        },
        { connection, concurrency: 1, settings: { backoffStrategy: () => 10 } },
      );
      assert.equal(await duplicate.waitUntilFinished(events, 10000), 'complete');
      assert.equal(runs, 2);
      await (await observer.getJob(key)).remove();
    } finally {
      await worker?.close();
      await events.close();
      await observer.close();
      await producer.close();
      connection.disconnect();
      if (previous === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previous;
    }
  },
);
