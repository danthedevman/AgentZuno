import { rateLimit } from 'express-rate-limit';
import { decryptSecret } from './secrets.js';
import { randomBytes, createHash } from 'node:crypto';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const failure = (message, status = 400) =>
  Object.assign(new Error(message), { status, publicMessage: message });
const providers = {
  notion: {
    authorize: 'https://api.notion.com/v1/oauth/authorize',
    token: 'https://api.notion.com/v1/oauth/token',
    prefix: 'NOTION',
  },
  confluence: {
    authorize: 'https://auth.atlassian.com/authorize',
    token: 'https://auth.atlassian.com/oauth/token',
    prefix: 'ATLASSIAN',
  },
};

export function installConnectionOAuthRoutes(app, store, service, fetcher = fetch) {
  app.use(
    '/api/connections/oauth/start',
    rateLimit({
      windowMs: 60000,
      limit: 20,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many attempts. Try again in a minute.' },
    }),
  );
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/api/connections/oauth',
    maxAge: 600000,
  };
  async function configuration(provider, user) {
    const settings = providers[provider];
    if (!settings) throw failure('Browser OAuth is not implemented for this adapter.', 422);
    const saved = await store
      .collection('sourceOAuthApplications')
      .findOne({ ownerId: user.id, workspaceId: user.workspaceId, provider });
    const clientId = saved?.clientId;
    const clientSecret = saved?.clientSecret ? decryptSecret(saved.clientSecret) : '';
    if (!clientId || !clientSecret)
      throw failure('This retired source requires a saved OAuth application configuration.', 503);
    const origin = new URL(process.env.APP_ORIGIN || 'http://localhost:3000');
    if (
      origin.protocol !== 'https:' &&
      !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname))
    )
      throw failure('OAuth requires a public HTTPS application origin.', 503);
    return {
      ...settings,
      clientId,
      clientSecret,
      redirectUri: `${origin.origin}/api/connections/oauth/callback`,
    };
  }
  function requireOwner(request) {
    if (!request.user || request.user.isDemo)
      throw failure('Sign in with a registered account.', 401);
  }
  app.post('/api/connections/oauth/start', async (request, response) => {
    requireOwner(request);
    if (!request.body?.connectionId)
      return response
        .status(410)
        .json({ error: 'New knowledge-source integrations have been removed.' });
    const input = request.body || {};
    const config = await configuration(input.provider, request.user);
    await service.validateOAuthInput(request.user, input);
    await store.ready();
    const state = randomBytes(32).toString('hex');
    const browser = randomBytes(32).toString('hex');
    await store.collection('connectionOAuthFlows').insertOne({
      stateHash: hash(state),
      browserHash: hash(browser),
      ownerId: request.user.id,
      workspaceId: request.user.workspaceId,
      provider: input.provider,
      knowledgeBaseId: typeof input.knowledgeBaseId === 'string' ? input.knowledgeBaseId : null,
      destination: input.destination || 'existing',
      permissionMode: input.permissionMode,
      cloudId: String(input.cloudId || ''),
      expiresAt: new Date(Date.now() + 600000),
    });
    const url = new URL(config.authorize);
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      state,
      ...(input.provider === 'notion'
        ? { owner: 'user' }
        : {
            audience: 'api.atlassian.com',
            scope:
              'read:confluence-content.all read:confluence-user read:page:confluence read:user:confluence',
            prompt: 'consent',
          }),
    }).toString();
    response.cookie('agentzuno_source_oauth', browser, cookieOptions).json({ url: url.href });
  });
  app.get('/api/connections/oauth/callback', async (request, response) => {
    requireOwner(request);
    const state = request.query.state;
    const browser = (request.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('agentzuno_source_oauth='))
      ?.split('=')[1];
    if (
      typeof state !== 'string' ||
      !/^[a-f0-9]{64}$/.test(state) ||
      !browser ||
      !/^[a-f0-9]{64}$/.test(browser)
    )
      throw failure('Invalid OAuth state.', 401);
    const flow = await store.collection('connectionOAuthFlows').findOneAndDelete({
      stateHash: hash(state),
      browserHash: hash(browser),
      ownerId: request.user.id,
      workspaceId: request.user.workspaceId,
      expiresAt: { $gt: new Date() },
    });
    response.clearCookie('agentzuno_source_oauth', cookieOptions);
    if (!flow) throw failure('OAuth request expired or was already used.', 401);
    if (
      request.query.error ||
      typeof request.query.code !== 'string' ||
      request.query.code.length > 4096
    )
      throw failure('Source authorization was not completed.');
    const config = await configuration(flow.provider, request.user);
    let tokens;
    try {
      const result = await fetcher(config.token, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(flow.provider === 'notion'
            ? {
                Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
              }
            : {}),
        },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code: request.query.code,
          redirect_uri: config.redirectUri,
          ...(flow.provider === 'confluence'
            ? { client_id: config.clientId, client_secret: config.clientSecret }
            : {}),
        }),
      });
      if (!result.ok) throw new Error();
      const content = await result.text();
      if (content.length > 65536) throw new Error();
      tokens = JSON.parse(content);
      if (
        typeof tokens.access_token !== 'string' ||
        !tokens.access_token ||
        tokens.access_token.length > 10000
      )
        throw new Error();
    } catch {
      throw failure(
        'The provider could not complete the token exchange. Retry authorization.',
        422,
      );
    }
    await service.connect(request.user, {
      ...flow,
      accessToken: tokens.access_token,
      authType: 'oauth',
      acceptManagedAccess: flow.permissionMode === 'managed',
    });
    response.redirect(`/workspace/${request.user.workspaceId}/integrations/${flow.provider}`);
  });
}
