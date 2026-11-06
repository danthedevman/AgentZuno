import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { createIntegrationStore } from '../storage/integrationStore.js';
import { createSemanticService } from './semantic.js';

const store = createIntegrationStore();
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
  for (const collection of ['knowledgeDocuments', 'knowledgeChunks', 'sourceConnections'])
    await store.collection(collection).deleteMany({ ownerId, workspaceId: ownerId });
  await store.close();
}
