import { secureCookies } from '../../identity/cookieSecurity.js';
import * as oidc from 'openid-client';
import { provisionIdentityUser } from '../../identity/helpdeskProvisioning.js';
import { randomBytes } from 'node:crypto';

import { encryptSecret, decryptSecret } from '../../shared/secrets.js';
import { readData } from '../../data/data.js';
import { failure, trustedUrl, hash, guardedFetch } from '../../identity/identity.js';
export function createIdentityController(store, auth) {
  const origin = () => process.env.APP_ORIGIN || 'http://localhost:3000';
  const callback = () => `${origin()}/api/auth/oidc/callback`;
  const requireUser = (request, response, next) =>
    request.user && !request.user.isDemo
      ? next()
      : response
          .status(401)
          .json({ error: 'Use a registered account to configure an identity provider.' });
  async function configFor(settings) {
    const secret = decryptSecret(settings.clientSecret);
    return oidc.discovery(
      trustedUrl(settings.issuer),
      settings.clientId,
      { client_secret: secret },
      oidc.ClientSecretPost(secret),
      { [oidc.customFetch]: guardedFetch },
    );
  }
  function safe(settings) {
    if (!settings) return null;
    const { provider, issuer, clientId, enabled, updatedAt } = settings;
    return {
      provider,
      issuer,
      clientId,
      enabled,
      autoProvision: settings.autoProvision === true,
      updatedAt,
      hasClientSecret: !!settings.clientSecret,
      callbackUrl: callback(),
    };
  }
  const getIdentityProviders = async (request, response) =>
    response.json(await readData('identity-providers.json'));
  const getSettingsIdentity = async (request, response) => {
    const settings = await store
      .collection('identitySettings')
      .findOne({ workspaceId: request.user.workspaceId, ownerId: request.user.id });
    response.json({
      settings: safe(settings),
      callbackUrl: callback(),
      linked: !!(await store
        .collection('linkedIdentities')
        .findOne({ ownerId: request.user.id, workspaceId: request.user.workspaceId })),
    });
  };
  const postSettingsIdentity = async (request, response) => {
    const {
      provider,
      issuer,
      clientId,
      clientSecret,
      enabled,
      autoProvision = true,
    } = request.body || {};
    const providers = await readData('identity-providers.json');
    if (
      !providers.some((item) => item.id === provider) ||
      typeof issuer !== 'string' ||
      issuer.length > 500 ||
      typeof clientId !== 'string' ||
      !clientId.trim() ||
      clientId.length > 500 ||
      typeof enabled !== 'boolean' ||
      typeof autoProvision !== 'boolean'
    )
      throw failure('Select a provider, issuer, client ID, and enablement preference.');
    trustedUrl(issuer);
    const previous = await store
      .collection('identitySettings')
      .findOne({ ownerId: request.user.id, workspaceId: request.user.workspaceId });
    const sameClient =
      previous?.issuer === issuer &&
      previous?.clientId === clientId &&
      previous?.provider === provider;
    if (
      (!clientSecret || typeof clientSecret !== 'string') &&
      !(sameClient && previous.clientSecret)
    )
      throw failure('Enter the client secret for this provider.');
    if (typeof clientSecret === 'string' && clientSecret.length > 10000)
      throw failure('Client secret is too long.');
    const settings = {
      ownerId: request.user.id,
      workspaceId: request.user.workspaceId,
      provider,
      issuer,
      clientId: clientId.trim(),
      enabled,
      autoProvision,
      clientSecret: clientSecret ? encryptSecret(clientSecret) : previous.clientSecret,
      updatedAt: new Date(),
    };
    await store
      .collection('identitySettings')
      .updateOne(
        { ownerId: request.user.id, workspaceId: request.user.workspaceId },
        { $set: settings },
        { upsert: true },
      );
    if (!sameClient)
      await store
        .collection('linkedIdentities')
        .deleteMany({ ownerId: request.user.id, workspaceId: request.user.workspaceId });
    response.json({ settings: safe(settings), callbackUrl: callback(), linked: sameClient });
  };
  const getAuthOidcProvider = async (request, response) => {
    const settings = await store
      .collection('identitySettings')
      .findOne({ workspaceId: String(request.query.workspace || ''), enabled: true });
    response.json(
      settings ? { provider: settings.provider, workspaceId: settings.workspaceId } : null,
    );
  };
  const getAuthOidcStart = async (request, response) => {
    const settings = await store
      .collection('identitySettings')
      .findOne({ workspaceId: String(request.query.workspace || ''), enabled: true });
    if (!settings) throw failure('Identity provider is not enabled.', 404);
    const link = request.query.link === '1';
    if (link && request.user?.id !== settings.ownerId)
      throw failure('Sign in as the workspace owner to link an identity.', 403);
    const config = await configFor(settings);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const verifier = oidc.randomPKCECodeVerifier();
    const browser = randomBytes(32).toString('hex');
    await store.collection('oidcFlows').insertOne({
      _id: hash(state),
      workspaceId: settings.workspaceId,
      ownerId: settings.ownerId,
      settingsUpdatedAt: settings.updatedAt,
      link,
      verifier,
      nonce,
      browserHash: hash(browser),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    response.cookie('agentzuno_oidc', browser, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies(),
      maxAge: 600000,
      path: '/api/auth/oidc',
    });
    response.redirect(
      oidc.buildAuthorizationUrl(config, {
        redirect_uri: callback(),
        scope: 'openid profile email',
        state,
        nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
      }).href,
    );
  };
  const getAuthOidcCallback = async (request, response) => {
    const state = String(request.query.state || '');
    const browser =
      request.headers.cookie
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('agentzuno_oidc='))
        ?.slice(15) || '';
    const flow = await store.collection('oidcFlows').findOneAndDelete({
      _id: hash(state),
      browserHash: hash(browser),
      expiresAt: { $gt: new Date() },
    });
    if (!flow) throw failure('Sign-in request expired or could not be verified.', 401);
    response.clearCookie('agentzuno_oidc', { path: '/api/auth/oidc' });
    const settings = await store
      .collection('identitySettings')
      .findOne({ workspaceId: flow.workspaceId, enabled: true, updatedAt: flow.settingsUpdatedAt });
    if (!settings) throw failure('Identity settings changed. Start sign-in again.', 401);
    const config = await configFor(settings);
    const tokens = await oidc.authorizationCodeGrant(
      config,
      new URL(request.originalUrl, origin()),
      {
        pkceCodeVerifier: flow.verifier,
        expectedState: state,
        expectedNonce: flow.nonce,
        idTokenExpected: true,
      },
    );
    const claims = tokens.claims();
    if (!claims?.sub || claims.iss !== settings.issuer)
      throw failure('Identity could not be verified.', 401);
    const key = { workspaceId: flow.workspaceId, issuer: claims.iss, subject: claims.sub };
    if (flow.link) {
      if (request.user?.id !== flow.ownerId)
        throw failure('Sign in as the owner to link this identity.', 403);
      const existing = await store.collection('linkedIdentities').findOne(key);
      if (existing && existing.ownerId !== flow.ownerId)
        throw failure('This identity is already linked.', 409);
      await store
        .collection('linkedIdentities')
        .updateOne(
          key,
          { $set: { ...key, ownerId: flow.ownerId, linkedAt: new Date() } },
          { upsert: true },
        );
      return response.redirect(`${origin()}/workspace/${flow.workspaceId}/settings`);
    }
    const identity = await store.collection('linkedIdentities').findOne(key);
    if (!identity) {
      const employee = await provisionIdentityUser(store, settings, claims);
      return auth.startSession(
        request,
        response,
        employee,
        200,
        `${origin()}/workspace/${flow.workspaceId}`,
      );
    }
    const user = await auth.accounts.findById(identity.ownerId);
    if (!user || user.workspaceId !== flow.workspaceId)
      throw failure('Account is not available.', 403);
    await auth.startSession(
      request,
      response,
      user,
      200,
      `${origin()}/workspace/${flow.workspaceId}`,
    );
  };
  return {
    getIdentityProviders,
    getSettingsIdentity,
    postSettingsIdentity,
    getAuthOidcProvider,
    getAuthOidcStart,
    getAuthOidcCallback,
    requireUser,
  };
}
