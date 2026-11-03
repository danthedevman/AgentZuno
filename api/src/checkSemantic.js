import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { createIntegrationStore } from './integrationStore.js';
import { createSemanticService } from './semantic.js';

process.env.MONGODB_DATABASE = `agentzuno_semantic_check_${randomUUID().replaceAll('-', '')}`;
const store = createIntegrationStore();
const cleanup = new MongoClient(process.env.MONGODB_URI);
const service = createSemanticService(store);
const ownerId = randomUUID();
const document = {
  _id: new ObjectId(),
  ownerId,
  workspaceId: ownerId,
  knowledgeBaseId: 'synthetic-base',
  connectionId: new ObjectId().toHexString(),
  runId: randomUUID(),
  title: 'Synthetic remote access guide',
  text: 'Request a VPN account from the help desk to connect securely from home.',
};
try {
  await store.ready();
  await store.collection('knowledgeDocuments').insertOne(document);
  await store.collection('sourceConnections').insertOne({
    _id: new ObjectId(document.connectionId),
    ownerId,
    workspaceId: ownerId,
    status: 'Connected',
    sync: { activeRunId: document.runId },
  });
  const chunks = await service.index(document);
  const matches = await service.search(
    { id: ownerId, workspaceId: ownerId },
    ['synthetic-base'],
    'working remotely with secure network access',
  );
  if (!matches.includes(document._id.toHexString()))
    throw new Error('Vector retrieval did not return the synthetic document.');
  console.log(
    JSON.stringify({
      semanticCheck: 'passed',
      embeddingDimensions: 768,
      chunks,
      matchingDocuments: matches.length,
    }),
  );
} finally {
  await store
    .collection('knowledgeDocuments')
    .updateOne({ _id: document._id }, { $set: { deletedAt: new Date() } });
  await service.cleanup();
  await cleanup.db(process.env.MONGODB_DATABASE).dropDatabase();
  await cleanup.close();
  await store.close();
}
