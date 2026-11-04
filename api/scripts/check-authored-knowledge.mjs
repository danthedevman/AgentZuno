import { randomUUID } from 'node:crypto';
import { ObjectId, MongoClient } from 'mongodb';
import { createIntegrationStore } from '../src/integrationStore.js';
import { createContentStore } from '../src/contentStore.js';
import { createAuthoredSemantic } from '../src/authoredSemantic.js';
import { retrieveAssistantKnowledge } from '../src/assistantKnowledge.js';

if (!process.env.MONGODB_URI || !process.env.OLLAMA_URL || !process.env.QDRANT_URL)
  throw new Error('Configure MongoDB, Ollama and Qdrant URLs before running this check.');
process.env.MONGODB_DATABASE = `agentzuno_authored_check_${randomUUID().replaceAll('-', '')}`;
const store = createIntegrationStore(),
  content = createContentStore(),
  client = new MongoClient(process.env.MONGODB_URI);
const service = createAuthoredSemantic(store);
const ownerId = randomUUID(),
  workspaceId = new ObjectId().toHexString();
let article;
try {
  await store.ready();
  await store.collection('users').insertOne({ id: ownerId, workspaceId });
  article = await content.saveArticle(ownerId, {
    workspaceId,
    title: 'Slack Access',
    body: '<p>Employees obtain Slack through the Software Access catalog item. Slack is the company team messaging tool.</p>',
    base: workspaceId,
    topicIds: [],
    status: 'Published',
    updatedAt: new Date().toISOString(),
  });
  await service.process({ id: article.id, ownerId, workspaceId });
  const matches = await retrieveAssistantKnowledge(
    store,
    {
      ownerId,
      providerOwnerId: ownerId,
      workspaceId,
      helpdeskPurpose: 'support',
      messages: [{ role: 'user', text: 'How do I collaborate with coworkers online?' }],
    },
    service,
  );
  if (
    !matches.some((item) => String(item.id) === article.id && item.retrievalMethod === 'semantic')
  )
    throw new Error('Expected a semantic article match without keyword overlap.');
  console.log(
    JSON.stringify({
      authoredKnowledgeCheck: 'passed',
      retrievalMethod: 'semantic',
      embeddingDimensions: 768,
      matchedArticles: matches.length,
    }),
  );
} finally {
  if (article) {
    await content.updateArticle(ownerId, article.id, { status: 'Draft' });
    await service.process({ id: article.id, ownerId, workspaceId });
  }
  await client.connect();
  await client.db(process.env.MONGODB_DATABASE).dropDatabase();
  await client.close();
  await content.close();
  await store.close();
}
