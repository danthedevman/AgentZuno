import { createStorageClient } from './storage/index.js';
import { auditDatabase } from './recordAudit.js';
import { ObjectId } from 'mongodb';

export function createIntegrationStore(databaseOverride) {
  const client = databaseOverride
    ? { configured: true, db: () => databaseOverride, close: async () => {} }
    : createStorageClient();
  function collection(name) {
    if (!client) throw Object.assign(new Error('MongoDB is not configured.'), { status: 503 });
    return auditDatabase(client.db(process.env.MONGODB_DATABASE || 'agentzuno')).collection(name);
  }
  let indexes;
  const objectId = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);
  return {
    collection,
    async ready() {
      indexes ||= Promise.all([
        collection('helpdeskTasks').createIndex({
          ownerId: 1,
          workspaceId: 1,
          requestId: 1,
          createdAt: 1,
        }),
        collection('articles').createIndex({ semanticStatus: 1, semanticRetryAt: 1, _id: 1 }),
        collection('authoredSemanticRetirements').createIndex({ status: 1 }),
        collection('authoredKnowledgeChunks').createIndex({
          ownerId: 1,
          workspaceId: 1,
          documentId: 1,
          runId: 1,
        }),
        collection('helpdeskChannelApplications').createIndex(
          { ownerId: 1, workspaceId: 1, provider: 1 },
          { unique: true },
        ),
        collection('workflowRevisions').createIndex(
          { ownerId: 1, workspaceId: 1, workflowId: 1, revision: 1 },
          { unique: true },
        ),
        collection('workflowRuns').createIndex({ ownerId: 1, workspaceId: 1, createdAt: -1 }),
        collection('workflowRuns').createIndex({ status: 1, leaseUntil: 1 }),
        collection('workforceProfiles').createIndex(
          { ownerId: 1, workspaceId: 1, userId: 1 },
          { unique: true },
        ),
        collection('workforceReferences').createIndex({ ownerId: 1, workspaceId: 1, type: 1 }),
        collection('adminDataConversations').createIndex(
          { ownerId: 1, workspaceId: 1, actorId: 1, chatId: 1 },
          { unique: true },
        ),
        collection('adminDataTables').createIndex({ ownerId: 1, workspaceId: 1 }),
        collection('adminDataRecords').createIndex({ ownerId: 1, workspaceId: 1, tableId: 1 }),
        collection('customDomains').createIndex({ domain: 1 }, { unique: true }),
        collection('customDomains').createIndex({ ownerId: 1, workspaceId: 1 }, { unique: true }),
        collection('helpdeskInbox').createIndex(
          { ownerId: 1, workspaceId: 1, requestId: 1 },
          { unique: true },
        ),
        collection('chatAttachments').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collection('chatAttachments').createIndex({ ownerId: 1, workspaceId: 1, createdAt: 1 }),
        collection('helpdeskChannels').createIndex(
          { ownerId: 1, workspaceId: 1, provider: 1 },
          { unique: true },
        ),
        collection('helpdeskChannels').createIndex(
          { provider: 1, slackTeamId: 1 },
          {
            unique: true,
            partialFilterExpression: { provider: 'slack', slackTeamId: { $type: 'string' } },
          },
        ),
        collection('helpdeskSlackMessages').createIndex({
          sourceId: 1,
          generation: 1,
          status: 1,
          createdAt: 1,
        }),
        collection('helpdeskEmailMessages').createIndex({ sourceId: 1, status: 1, createdAt: 1 }),
        collection('helpdeskEmailThreads').createIndex({ workspaceId: 1, sourceId: 1 }),
        collection('helpdeskChannelOAuth').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collection('helpdeskProvisioningTokens').createIndex({ workspaceId: 1 }, { unique: true }),
        collection('helpdeskDirectoryUsers').createIndex(
          { workspaceId: 1, issuer: 1, userName: 1 },
          { unique: true },
        ),
        collection('helpdeskDirectoryUsers').createIndex(
          { workspaceId: 1, issuer: 1, externalId: 1 },
          { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } },
        ),
        collection('helpdeskIdentities').createIndex(
          { workspaceId: 1, issuer: 1, subject: 1 },
          { unique: true },
        ),
        collection('helpdeskDrafts').createIndex(
          { ownerId: 1, workspaceId: 1, chatId: 1 },
          { unique: true },
        ),
        collection('helpdeskMembers').createIndex({ workspaceId: 1, userId: 1 }, { unique: true }),
        collection('workflowConversationViews').createIndex(
          { ownerId: 1, workspaceId: 1, actorId: 1, workflowId: 1 },
          { unique: true },
        ),
        collection('helpdeskMembers').createIndex({ userId: 1, active: 1 }),
        collection('helpdeskMembershipHistory').createIndex({ workspaceId: 1, at: -1 }),
        collection('governanceAudit').createIndex({ ownerId: 1, workspaceId: 1, startedAt: -1 }),
        collection('governanceAudit').createIndex({
          ownerId: 1,
          workspaceId: 1,
          workflowId: 1,
          startedAt: -1,
        }),
        collection('helpdeskWorkflows').createIndex({
          ownerId: 1,
          workspaceId: 1,
          department: 1,
          enabled: 1,
        }),
        collection('helpdeskWorkflowConversations').createIndex(
          { ownerId: 1, workspaceId: 1, chatId: 1 },
          { unique: true },
        ),
        collection('helpdeskRequests').createIndex(
          { ownerId: 1, workspaceId: 1, requestId: 1 },
          { unique: true },
        ),
        collection('helpdeskRequests').createIndex({ ownerId: 1, workspaceId: 1, updatedAt: -1 }),
        collection('helpdeskRequests').createIndex({
          ownerId: 1,
          workspaceId: 1,
          assignedToId: 1,
          updatedAt: -1,
        }),
        collection('helpdeskRequests').createIndex({
          ownerId: 1,
          workspaceId: 1,
          requesterId: 1,
          chatId: 1,
        }),
        collection('helpdeskSettings').createIndex(
          { ownerId: 1, workspaceId: 1 },
          { unique: true },
        ),
        collection('knowledgeChunks').createIndex({
          ownerId: 1,
          workspaceId: 1,
          knowledgeBaseId: 1,
          documentId: 1,
          runId: 1,
        }),
        collection('knowledgeDocuments').createIndex({
          ownerId: 1,
          workspaceId: 1,
          knowledgeBaseId: 1,
          runId: 1,
          deletedAt: 1,
        }),
        collection('knowledgeDocuments').createIndex({ semanticStatus: 1, semanticRetryAt: 1 }),
        collection('knowledgeViews').createIndex(
          { ownerId: 1, workspaceId: 1, eventId: 1 },
          { unique: true },
        ),
        collection('knowledgeViews').createIndex({ ownerId: 1, workspaceId: 1, at: 1 }),
        collection('knowledgeAudit').createIndex({ ownerId: 1, workspaceId: 1, at: 1 }),
        collection('records').createIndex(
          { ownerId: 1, workspaceId: 1, sourceConnectionId: 1, sourceBaseId: 1 },
          {
            unique: true,
            partialFilterExpression: {
              sourceConnectionId: { $type: 'string' },
              sourceBaseId: { $type: 'string' },
            },
          },
        ),
        collection('aiProviders').createIndex({ ownerId: 1, provider: 1 }, { unique: true }),
        collection('aiPreferences').createIndex({ ownerId: 1 }, { unique: true }),
        collection('chats').createIndex(
          { ownerId: 1, workspaceId: 1, requestId: 1 },
          { unique: true },
        ),
        collection('chats').createIndex({ status: 1, leaseUntil: 1 }),
        collection('sourceConnections').createIndex({ status: 1, 'sync.nextAt': 1 }),
        collection('knowledgeDocuments').createIndex(
          { connectionId: 1, sourceId: 1, runId: 1 },
          { unique: true },
        ),
        collection('identitySettings').createIndex({ workspaceId: 1 }, { unique: true }),
        collection('linkedIdentities').createIndex(
          { workspaceId: 1, issuer: 1, subject: 1 },
          { unique: true },
        ),
        collection('agentTokens').createIndex({ hash: 1 }, { unique: true }),
        collection('agentTokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collection('connectionOAuthFlows').createIndex({ stateHash: 1 }, { unique: true }),
        collection('connectionOAuthFlows').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        collection('oidcFlows').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      ]);
      await indexes;
    },
    async connection(ownerId, id) {
      return objectId(id)
        ? collection('sourceConnections').findOne({ _id: objectId(id), ownerId })
        : null;
    },
    async connections(ownerId) {
      return client ? collection('sourceConnections').find({ ownerId }).toArray() : [];
    },
    async record(ownerId, id, type) {
      return objectId(id)
        ? collection('records').findOne({ _id: objectId(id), ownerId, type })
        : null;
    },
    close: () => client?.close(),
  };
}
