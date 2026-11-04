import express from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { createMemoryDatabase } from './storage/memory.js';
import { isAllowedBrowserOrigin } from './browserOrigin.js';
import { readData } from './data.js';
import { applyAdminGroupAction } from './adminGroupActions.js';

export function installInteractiveDemoRoutes(parent, createApi) {
  const sessions = new Map(),
    attempts = new Map();
  let initializing = 0;
  parent.locals.closeInteractiveDemo = async () => {
    for (const session of sessions.values()) {
      try {
        const value = await session.value;
        await value.app.locals.close();
        value.database.clear();
      } catch {}
    }
    sessions.clear();
  };
  const hash = (token) => createHash('sha256').update(token).digest('hex');
  async function createSession() {
    const database = createMemoryDatabase();
    const user = {
      id: new ObjectId().toString(),
      workspaceId: new ObjectId().toString(),
      name: 'Alex Morgan',
      email: 'alex@example.test',
      role: 'admin',
      isDemo: false,
      isInteractiveDemo: true,
    };
    const scope = { ownerId: user.id, workspaceId: user.workspaceId };
    await database.collection('users').insertOne({ ...user, createdAt: new Date() });
    await database.collection('helpdeskMembers').insertOne({
      ...scope,
      userId: user.id,
      email: user.email,
      role: 'admin',
      active: true,
      canApprove: true,
      queues: [],
      version: 1,
      createdAt: new Date(),
    });
    let impersonation = null;
    const auth = {
      login: (request, response) =>
        response.status(403).json({ error: 'Sign-in is unavailable in the demo.' }),
      register: (request, response) =>
        response.status(403).json({ error: 'Registration is unavailable in the demo.' }),
      currentUser: async () => ({ ...user, impersonation }),
      setImpersonation: async (request, value) => {
        impersonation = value;
      },
      close: async () => {},
      accounts: { findById: async (id) => database.collection('users').findOne({ id }) },
      logout: (request, response) => response.json({ user: null }),
    };
    const queues = {
      close: async () => {},
      sync: async () => {},
      slack: async () => {},
      email: async () => {},
      workflow: async () => {},
      chat: async (job) => {
        const chat = await database.collection('chats').findOne({ _id: new ObjectId(job.id) });
        if (!chat) return;
        const prompts = (await readData('interactive-demo.json')).prompts;
        const prompt = prompts.find(
          (item) =>
            item.prompt === chat.messages.filter((message) => message.role === 'user').at(-1)?.text,
        );
        let text = prompt?.reply || 'Choose a predefined prompt to explore this conversation.';
        const formWorkflow =
          chat.assistantType === 'support' && ['laptop', 'figma'].includes(prompt?.id)
            ? await database.collection('helpdeskWorkflows').findOne({
                ...scope,
                name: prompt.id === 'laptop' ? 'Laptop Provisioning' : 'Software Access Approval',
              })
            : null;
        if (chat.assistantType === 'admin') {
          if (prompt?.id === 'group') text = 'Creating the requested group.';
          else if (chat.dataDesigner)
            text =
              'Here is a table to review.\n```json\n' +
              JSON.stringify(
                chat.dataDraft || {
                  name: 'Office Locations',
                  description: 'Offices used by support teams',
                  fields: [{ id: 'name', label: 'Name', type: 'text', required: true }],
                },
              ) +
              '\n```';
          else if (chat.articleDraft)
            text =
              'Here is the proposed article for your review.\n```json\n' +
              JSON.stringify(chat.articleDraft) +
              '\n```';
          else {
            const workflow = await database.collection('helpdeskWorkflows').findOne({ ...scope });
            text =
              'Here is a workflow you can review and adjust in the demo.\n```typescript\n' +
              (chat.workflowSource || workflow?.source || '') +
              '\n```';
          }
        }
        text = await applyAdminGroupAction(
          { collection: (name) => database.collection(name), ready: async () => {} },
          chat,
          text,
        );
        const at = new Date();
        await database.collection('chats').updateOne(
          { _id: chat._id },
          {
            $set: {
              status: 'complete',
              phase: 'complete',
              updatedAt: at,
              ...(formWorkflow
                ? {
                    requestForm: {
                      workflowId: String(formWorkflow._id),
                      workflowVersion: formWorkflow.publishedRevision,
                      ...formWorkflow.publishedConfig.definition.form,
                    },
                  }
                : {}),
              messages: chat.messages.map((message) =>
                message.id === job.responseId
                  ? {
                      ...message,
                      text,
                      status: 'complete',
                      phase: 'complete',
                      progress: [
                        { phase: 'queued', at },
                        { phase: 'retrieving', at },
                        { phase: 'responding', at },
                        { phase: 'complete', at },
                      ],
                    }
                  : message,
              ),
              progressEvents: [
                { phase: 'queued', at },
                { phase: 'retrieving', at },
                { phase: 'responding', at },
                { phase: 'complete', at },
              ],
            },
          },
        );
      },
    };
    const app = createApi({ database, auth, queues, isInteractiveDemo: true });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/helpdesk/demo/settings`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'load', industry: 'tech', enableApprovals: true }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to initialize demo.');
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    function cleanLabels(value) {
      if (typeof value === 'string')
        return value.replace(/\bDemo:?\s+/g, '').replace(/\bdemo\b/g, 'example');
      if (Array.isArray(value)) return value.map(cleanLabels);
      if (value && Object.getPrototypeOf(value) === Object.prototype)
        return Object.fromEntries(
          Object.entries(value)
            .filter(
              ([key]) => !['demo', 'demoDatasetId', 'demoIndustry', 'demoSeedKey'].includes(key),
            )
            .map(([key, item]) => [key, key.startsWith('demo') ? item : cleanLabels(item)]),
        );
      return value;
    }
    database.mapRecords(cleanLabels);
    return { app, database, expiresAt: Date.now() + 30 * 60 * 1000 };
  }
  parent.use('/api/demo-api', express.json({ limit: '64kb' }), async (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    if (
      request.headers['sec-fetch-site'] === 'cross-site' ||
      (request.headers.origin &&
        !isAllowedBrowserOrigin(
          request.headers.origin,
          process.env.APP_ORIGIN || 'http://localhost:3000',
        ))
    )
      return response.status(403).json({ error: 'Cross-origin demo access is not allowed.' });
    for (const [key, session] of sessions)
      if (session.expiresAt < Date.now()) {
        sessions.delete(key);
        session.value.then((value) => value.app.locals.close()).catch(() => {});
      }
    for (const [ip, attempt] of attempts) if (attempt.until < Date.now()) attempts.delete(ip);
    const token = request.headers.cookie
      ?.split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('agentzuno_demo='))
      ?.slice('agentzuno_demo='.length);
    let session = /^[a-f0-9]{64}$/.test(token || '') ? sessions.get(hash(token)) : null;
    if (request.path === '/api/demo/reset' && request.method === 'POST') {
      if (session) {
        sessions.delete(hash(token));
        const value = await session.value;
        await value.app.locals.close();
        value.database.clear();
      }
      response.clearCookie('agentzuno_demo', { path: '/api/demo-api' });
      return response.json({ reset: true });
    }
    if (!session) {
      if (initializing >= 2)
        return response
          .status(429)
          .json({ error: 'The demo is starting another session. Please retry shortly.' });
      const now = Date.now(),
        attempt = attempts.get(request.ip) || { count: 0, until: now + 60000 };
      if (attempt.until < now) {
        attempt.count = 0;
        attempt.until = now + 60000;
      }
      attempts.set(request.ip, attempt);
      if (++attempt.count > 6 || sessions.size >= 25)
        return response.status(429).json({ error: 'The demo is busy. Please try again shortly.' });
      const nextToken = randomBytes(32).toString('hex');
      session = {
        expiresAt: now + 30 * 60 * 1000,
        value: (() => {
          initializing++;
          return createSession().finally(() => initializing--);
        })(),
      };
      sessions.set(hash(nextToken), session);
      response.cookie('agentzuno_demo', nextToken, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.COOKIE_SECURE === 'true',
        path: '/api/demo-api',
        maxAge: 30 * 60 * 1000,
      });
    }
    if (/^\/api\/(installation|auth\/(login|register|oidc)|provisioning)/.test(request.path))
      return response.status(403).json({
        error: 'Account and installation changes are unavailable in the interactive demo.',
      });
    if (
      (!['GET', 'HEAD'].includes(request.method) &&
        /^\/api\/(?:connections|settings\/(?:ai|identity)|uploads|helpdesk\/(?:invitations|domain|smtp|email|demo\/settings))/.test(
          request.path,
        )) ||
      (!['GET', 'HEAD'].includes(request.method) &&
        /^\/api\/helpdesk\/channels/.test(request.path) &&
        !request.path.endsWith('/actions')) ||
      /oauth|\/sync(?:\/|$)/.test(request.path)
    )
      return response.status(403).json({
        error: 'Live connections and external actions are disabled in the interactive demo.',
      });
    if (!['GET', 'HEAD'].includes(request.method) && /attachments|uploads/.test(request.path))
      return response
        .status(403)
        .json({ error: 'File uploads are unavailable in the interactive demo.' });
    if (!['GET', 'HEAD'].includes(request.method)) {
      session.writes = (session.writes || 0) + 1;
      if (session.writes > 100)
        return response.status(429).json({ error: 'Reset the demo to continue exploring.' });
    }
    session.requests = (session.requests || 0) + 1;
    if (session.requests > 1000)
      return response.status(429).json({ error: 'Reset the demo to continue exploring.' });
    try {
      const value = await session.value;
      value.app(request, response, next);
    } catch {
      for (const [key, value] of sessions) if (value === session) sessions.delete(key);
      response.clearCookie('agentzuno_demo', { path: '/api/demo-api' });
      response.status(503).json({ error: 'The interactive demo could not load. Please retry.' });
    }
  });
}
