import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { createSemanticService, chunkText, pointId } from '../src/semantic.js';

test('semantic chunks overlap and point IDs are stable across retries', () => {
  const chunks = chunkText('x'.repeat(4000));
  assert.deepEqual(
    chunks.map((text) => text.length),
    [1800, 1800, 800],
  );
  assert.equal(pointId('doc', 'run', 0), pointId('doc', 'run', 0));
  assert.notEqual(pointId('doc', 'run', 0), pointId('doc', 'next', 0));
});

test('semantic storage persists chunks and vectors, and search filters owner, workspace, base and live generation', async () => {
  const previous = [process.env.OLLAMA_URL, process.env.QDRANT_URL];
  process.env.OLLAMA_URL = 'http://ollama.test';
  process.env.QDRANT_URL = 'http://qdrant.test';
  const writes = [];
  const calls = [];
  const document = {
    _id: new ObjectId(),
    title: 'VPN',
    text: 'Connect securely.',
    ownerId: 'owner',
    workspaceId: 'workspace',
    knowledgeBaseId: 'base',
    connectionId: 'connection',
    runId: 'run',
  };
  const store = {
    collection: (name) => ({
      updateOne: async (...args) => {
        writes.push({ name, args });
      },
      find: () => ({ toArray: async () => [{ sync: { activeRunId: 'run' } }] }),
    }),
  };
  const service = createSemanticService(store, async (url, options = {}) => {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, body });
    if (path === '/api/embed')
      return Response.json({ embeddings: body.input.map(() => Array(768).fill(0.1)) });
    if (path.endsWith('/points/query'))
      return Response.json({
        result: { points: [{ payload: { documentId: document._id.toHexString() } }] },
      });
    if (options.method === 'GET' || !options.method) return Response.json({ result: {} });
    return Response.json({ result: true });
  });
  try {
    assert.equal(await service.index(document), 1);
    const chunk = writes.find((write) => write.name === 'knowledgeChunks').args[1].$set;
    assert.equal(chunk.embedding.length, 768);
    assert.match(chunk.text, /Connect securely/);
    assert.equal(chunk.ownerId, 'owner');
    const points = calls.find((call) => call.path.endsWith('/points')).body.points;
    assert.equal('text' in points[0].payload, false);
    assert.deepEqual(
      await service.search({ id: 'owner', workspaceId: 'workspace' }, ['base'], 'remote access'),
      [document._id.toHexString()],
    );
    const filter = calls.find((call) => call.path.endsWith('/points/query')).body.filter.must;
    for (const key of ['ownerId', 'workspaceId', 'knowledgeBaseId', 'runId'])
      assert.ok(filter.some((item) => item.key === key));
  } finally {
    for (const [index, key] of ['OLLAMA_URL', 'QDRANT_URL'].entries())
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
  }
});
