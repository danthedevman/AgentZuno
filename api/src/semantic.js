import { createHash } from 'node:crypto';

export const collectionName = 'agentzuno_knowledge_v1';
export function chunkText(text, size = 1800, overlap = 200) {
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += size - overlap)
    chunks.push(text.slice(offset, offset + size));
  return chunks.length ? chunks : [''];
}
export function pointId(documentId, runId, index) {
  const hex = createHash('sha256')
    .update(`${documentId}:${runId}:${index}`)
    .digest('hex')
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function createSemanticService(store, fetcher = fetch) {
  const enabled = !!process.env.OLLAMA_URL && !!process.env.QDRANT_URL;
  const model = 'nomic-embed-text';
  async function request(base, path, body, method = 'POST') {
    const response = await fetcher(new URL(path, base), {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(base === process.env.OLLAMA_URL ? 120000 : 12000),
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok)
      throw new Error('Semantic service unavailable. Check Ollama model and Qdrant.');
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('Semantic response exceeded its limit.');
      }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async function embed(input, query = false) {
    const data = await request(process.env.OLLAMA_URL, '/api/embed', {
      model,
      input: input.map((text) => `${query ? 'search_query' : 'search_document'}: ${text}`),
      truncate: false,
    });
    if (
      !Array.isArray(data.embeddings) ||
      data.embeddings.length !== input.length ||
      data.embeddings.some(
        (vector) =>
          !Array.isArray(vector) ||
          vector.length !== 768 ||
          vector.some((value) => !Number.isFinite(value)),
      )
    )
      throw new Error('Unexpected embedding model dimensions.');
    return data.embeddings;
  }
  let ready;
  async function initialize() {
    if (!enabled) return;
    ready ||= (async () => {
      const response = await fetcher(
        new URL(`/collections/${collectionName}`, process.env.QDRANT_URL),
        { redirect: 'error', signal: AbortSignal.timeout(10000) },
      );
      await response.body?.cancel();
      if (response.status === 404) {
        try {
          await request(
            process.env.QDRANT_URL,
            `/collections/${collectionName}`,
            { vectors: { size: 768, distance: 'Cosine' } },
            'PUT',
          );
        } catch (error) {
          const retry = await fetcher(
            new URL(`/collections/${collectionName}`, process.env.QDRANT_URL),
          );
          await retry.body?.cancel();
          if (!retry.ok) throw error;
        }
      } else if (!response.ok) throw new Error('Qdrant unavailable.');
      for (const field_name of ['ownerId', 'workspaceId', 'knowledgeBaseId', 'documentId', 'runId'])
        await request(
          process.env.QDRANT_URL,
          `/collections/${collectionName}/index?wait=true`,
          { field_name, field_schema: 'keyword' },
          'PUT',
        );
    })().catch((error) => {
      ready = undefined;
      throw error;
    });
    return ready;
  }
  async function index(document) {
    if (!enabled) throw new Error('Semantic services are not configured.');
    await initialize();
    const documentId = document._id.toHexString();
    const texts = chunkText(`${document.title}\n${document.text}`);
    for (let offset = 0; offset < texts.length; offset += 8) {
      const batch = texts.slice(offset, offset + 8);
      const vectors = await embed(batch);
      const points = [];
      for (let i = 0; i < batch.length; i++) {
        const id = pointId(documentId, document.runId, offset + i);
        const payload = {
          documentId,
          connectionId: document.connectionId,
          ownerId: document.ownerId,
          workspaceId: document.workspaceId,
          knowledgeBaseId: document.knowledgeBaseId,
          runId: document.runId,
        };
        await store.collection('knowledgeChunks').updateOne(
          { _id: id },
          {
            $set: {
              ...payload,
              text: batch[i],
              embedding: vectors[i],
              model,
              updatedAt: new Date(),
            },
          },
          { upsert: true },
        );
        points.push({ id, vector: vectors[i], payload });
      }
      await request(
        process.env.QDRANT_URL,
        `/collections/${collectionName}/points?wait=true`,
        { points },
        'PUT',
      );
    }
    return texts.length;
  }
  async function search(user, knowledgeBaseIds, query) {
    if (!enabled) return [];
    const active = await store
      .collection('sourceConnections')
      .find({
        ownerId: user.id,
        workspaceId: user.workspaceId,
        status: 'Connected',
        'sync.activeRunId': { $exists: true },
      })
      .toArray();
    const runs = active.map((connection) => connection.sync.activeRunId);
    if (!runs.length) return [];
    await initialize();
    const [vector] = await embed([query], true);
    const data = await request(
      process.env.QDRANT_URL,
      `/collections/${collectionName}/points/query`,
      {
        query: vector,
        filter: {
          must: [
            { key: 'runId', match: { any: runs } },
            { key: 'ownerId', match: { value: user.id } },
            { key: 'workspaceId', match: { value: user.workspaceId } },
            { key: 'knowledgeBaseId', match: { any: knowledgeBaseIds } },
          ],
        },
        limit: 50,
        with_payload: true,
        with_vector: false,
      },
    );
    return [
      ...new Set(
        (data.result?.points || [])
          .map((point) => point.payload?.documentId)
          .filter((id) => typeof id === 'string' && /^[a-f0-9]{24}$/.test(id)),
      ),
    ];
  }
  async function cleanup() {
    if (!enabled) return;
    const retired = await store
      .collection('knowledgeDocuments')
      .find({ deletedAt: { $exists: true }, semanticStatus: { $ne: 'Retired' } })
      .limit(100)
      .toArray();
    if (!retired.length) return;
    await initialize();
    const ids = retired.map((item) => item._id.toHexString());
    await request(
      process.env.QDRANT_URL,
      `/collections/${collectionName}/points/delete?wait=true`,
      { filter: { must: [{ key: 'documentId', match: { any: ids } }] } },
    );
    await store.collection('knowledgeChunks').deleteMany({ documentId: { $in: ids } });
    await store
      .collection('knowledgeDocuments')
      .updateMany(
        { _id: { $in: retired.map((item) => item._id) }, deletedAt: { $exists: true } },
        { $set: { semanticStatus: 'Retired' } },
      );
  }
  return { enabled, index, search, cleanup };
}
