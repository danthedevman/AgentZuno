import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { fetchChannelJson } from './helpdeskChannels.js';
import { deny } from '../identity/helpdeskRoles.js';
const caches = new WeakMap();
export function teamsServiceUrl(value) {
  if (typeof value !== 'string' || value.length > 300) deny('Invalid Teams service URL.', 401);
  let url;
  try {
    url = new URL(value);
  } catch {
    deny('Invalid Teams service URL.', 401);
  }
  if (
    url.protocol !== 'https:' ||
    !['smba.trafficmanager.net', 'smba.infra.teams.microsoft.com'].includes(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[a-zA-Z0-9/_-]*\/$/.test(url.pathname)
  )
    deny('Unsupported Teams service URL.', 401);
  return url.href;
}
export async function verifyTeamsActivity(activity, authorization, clientId, fetcher = fetch) {
  if (
    typeof authorization !== 'string' ||
    !/^Bearer [A-Za-z0-9._-]+$/.test(authorization) ||
    authorization.length > 16000
  )
    deny('Teams request could not be verified.', 401);
  const serviceUrl = teamsServiceUrl(activity?.serviceUrl);
  if (activity?.channelId !== 'msteams') deny('Unsupported Teams channel.', 401);
  const token = authorization.slice(7);
  let header;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    deny('Teams request could not be verified.', 401);
  }
  let cached = caches.get(fetcher);
  if (
    !cached ||
    cached.expiresAt < Date.now() ||
    (!cached.keys.some((key) => key.kid === header.kid) && cached.fetchedAt < Date.now() - 30000)
  ) {
    const metadata = await fetchChannelJson(
      fetcher,
      'https://login.botframework.com/v1/.well-known/openidconfiguration',
      {},
    );
    if (
      metadata.issuer !== 'https://api.botframework.com' ||
      metadata.jwks_uri !== 'https://login.botframework.com/v1/.well-known/keys' ||
      !metadata.id_token_signing_alg_values_supported?.includes('RS256')
    )
      deny('Teams signing configuration could not be verified.', 401);
    const jwks = await fetchChannelJson(fetcher, metadata.jwks_uri, {});
    if (!Array.isArray(jwks.keys) || jwks.keys.length > 100)
      deny('Invalid Teams signing keys.', 401);
    cached = { keys: jwks.keys, expiresAt: Date.now() + 3600000, fetchedAt: Date.now() };
    caches.set(fetcher, cached);
  }
  const keys = cached.keys.filter(
    (key) =>
      key.kid === header.kid &&
      Array.isArray(key.endorsements) &&
      key.endorsements.includes('msteams'),
  );
  if (!keys.length || header.alg !== 'RS256')
    deny('Teams channel signature could not be verified.', 401);
  try {
    const { payload } = await jwtVerify(token, createLocalJWKSet({ keys }), {
      algorithms: ['RS256'],
      issuer: 'https://api.botframework.com',
      audience: clientId,
      requiredClaims: ['exp', 'nbf', 'iss', 'aud', 'serviceUrl'],
      clockTolerance: 60,
    });
    if (
      payload.serviceUrl !== activity.serviceUrl ||
      teamsServiceUrl(payload.serviceUrl) !== serviceUrl
    )
      deny('Teams service URL did not match its signature.', 401);
  } catch {
    deny('Teams request could not be verified.', 401);
  }
  return serviceUrl;
}
