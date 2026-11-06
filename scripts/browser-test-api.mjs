import { createRequire } from 'node:module';
const { ObjectId } = createRequire(new URL('../api/package.json', import.meta.url))('mongodb');
import { randomBytes } from 'node:crypto';
import { createApi } from '../api/src/app.js';
import { createMemoryDatabase } from '../api/src/storage/memory.js';

// Browser regressions must never connect to a developer's database, Redis, or AI provider.
for (const key of [
  'MONGODB_URI',
  'POSTGRES_URL',
  'DATABASE_PROVIDER',
  'INSTALLATION_CONFIG_DIR',
  'REDIS_URL',
  'OLLAMA_URL',
  'QDRANT_URL',
])
  delete process.env[key];
process.env.APP_ORIGIN = 'http://127.0.0.1:4180';
process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.COOKIE_SECURE = 'false';
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (url.protocol === 'http:' && url.hostname === '127.0.0.1') return nativeFetch(input, options);
  throw new Error('External requests are disabled in the browser test API.');
};
const database = createMemoryDatabase();
const user = {
  id: '111111111111111111111111',
  workspaceId: '222222222222222222222222',
  name: 'Alex Morgan',
  email: 'alex@example.test',
  role: 'admin',
};
await database.collection('users').insertOne(user);
await database.collection('helpdeskMembers').insertOne({
  ownerId: user.id,
  workspaceId: user.workspaceId,
  userId: user.id,
  email: user.email,
  role: 'admin',
  active: true,
  queues: [],
  version: 1,
});
const auth = {
  currentUser: async (request) =>
    request.headers.cookie?.includes('browser_test=1') ? user : null,
  accounts: { findById: async (id) => database.collection('users').findOne({ id }) },
  close: async () => {},
  login: (request, response) => response.status(403).json({ error: 'Test fixture' }),
  register: (request, response) => response.status(403).json({ error: 'Test fixture' }),
  logout: (request, response) => response.json({ user: null }),
};
const app = createApi({ database, auth });
const server = app.listen(4181, '127.0.0.1', () => console.log('Isolated browser test API ready'));
await new Promise((resolve) => (server.listening ? resolve() : server.once('listening', resolve)));
const seeded = await nativeFetch('http://127.0.0.1:4181/api/helpdesk/demo/settings', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', cookie: 'browser_test=1' },
  body: JSON.stringify({ action: 'load', industry: 'tech', enableApprovals: true }),
});
if (!seeded.ok) throw new Error(await seeded.text());
if (process.env.UPDATE_README_SCREENSHOTS) {
  const scope = { ownerId: user.id, workspaceId: user.workspaceId };
  const now = new Date();
  for (const [index, title] of [
    'IT demo: Register an AI tool',
    'IT demo: Replacement laptop',
    'IT demo: VPN access help',
  ].entries())
    await database.collection('chats').insertOne({
      _id: new ObjectId(`33333333333333333333333${index + 1}`),
      ...scope,
      providerOwnerId: user.id,
      requestId: `readme-demo-${index}`,
      title,
      status: 'completed',
      helpdeskPurpose: 'support',
      assistantType: 'support',
      createdAt: now,
      updatedAt: now,
      messages: [
        {
          id: `demo-user-${index}`,
          role: 'user',
          text:
            index === 2
              ? 'I cannot connect to the VPN from my home network.'
              : index === 1
                ? 'I need a replacement laptop for development.'
                : 'Please register the AI tool our IT team uses for code review.',
          status: 'completed',
          createdAt: now,
        },
        {
          id: `demo-agent-${index}`,
          role: 'assistant',
          text:
            index === 2
              ? 'Check your VPN client connection and multifactor prompt. I can help you submit an IT support request if it still fails.'
              : index === 1
                ? 'Your laptop request is ready for manager review.'
                : 'The registration request was submitted and linked to the AI tool record.',
          status: 'completed',
          createdAt: now,
        },
      ],
    });
  const workflow = await database.collection('helpdeskWorkflows').findOne(scope);
  const request = await database.collection('helpdeskRequests').findOne(scope);
  const audit = {
    ...scope,
    _id: '44444444-4444-4444-8444-444444444444',
    workflowId: String(workflow._id),
    workflowName: workflow.name,
    workflowRunId: '5'.repeat(64),
    stepId: 'register-device',
    toolName: 'createDataRecord',
    toolCallId: 'demo-tool-call-001',
    responseId: 'demo-response-001',
    rootAuditId: '44444444-4444-4444-8444-444444444440',
    parentAuditId: '44444444-4444-4444-8444-444444444440',
    requestAuditId: '44444444-4444-4444-8444-444444444440',
    requestId: String(request._id),
    actorId: user.id,
    actorType: 'user',
    role: 'admin',
    actualRole: 'admin',
    isImpersonating: false,
    triggerType: 'workflow-step',
    triggerLabel: 'Submitted laptop request form',
    action: 'workflow.data.create',
    method: 'POST',
    target: '/data/devices/records',
    resourceId: '666666666666666666666666',
    outcome: 'completed',
    statusCode: 201,
    startedAt: new Date(now.getTime() - 350),
    completedAt: now,
    versionBefore: 0,
    versionAfter: 1,
    matchedCount: 0,
    modifiedCount: 0,
    insertedCount: 1,
    deletedCount: 0,
    recordCount: 0,
    changedFields: ['model', 'requestedFor', 'request'],
  };
  await database.collection('governanceAudit').insertOne(audit);
  await database.collection('governanceAudit').insertOne({
    ...audit,
    _id: audit.rootAuditId,
    parentAuditId: undefined,
    action: 'workflow.execution',
    toolName: 'runWorkflow',
    toolCallId: 'demo-run-001',
    changedFields: ['status'],
  });
}
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await app.locals.close();
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => close().catch(() => (process.exitCode = 1)));
