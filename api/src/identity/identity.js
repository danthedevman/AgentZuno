import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList } from 'node:net';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
const blocked = new BlockList();
for (const [address, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
])
  blocked.addSubnet(address, bits, 'ipv4');
for (const [address, bits] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['::ffff:0:0', 96],
])
  blocked.addSubnet(address, bits, 'ipv6');
export const failure = (message, status = 400) =>
  Object.assign(new Error(message), { status, publicMessage: message });
export function trustedUrl(value) {
  const url = new URL(value);
  const custom = (process.env.OIDC_ALLOWED_ORIGINS || '').split(',').filter(Boolean);
  const known =
    [
      'login.microsoftonline.com',
      'accounts.google.com',
      'oauth2.googleapis.com',
      'www.googleapis.com',
      'auth.pingone.com',
      'auth.pingone.eu',
      'auth.pingone.ca',
      'auth.pingone.asia',
    ].includes(url.hostname) ||
    [
      '.okta.com',
      '.oktapreview.com',
      '.okta-emea.com',
      '.auth0.com',
      '.onelogin.com',
      '.pingidentity.com',
    ].some((suffix) => url.hostname.endsWith(suffix));
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (!known && !custom.includes(url.origin))
  )
    throw failure(
      'Use a supported HTTPS issuer, or allow its origin in OIDC_ALLOWED_ORIGINS on the API server.',
    );
  return url;
}
export async function guardedFetch(url, options) {
  const safe = trustedUrl(String(url));
  const addresses = await lookup(safe.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some((value) => blocked.check(value.address, value.family === 4 ? 'ipv4' : 'ipv6'))
  )
    throw failure('Identity provider endpoints must use public network addresses.');
  return fetch(safe, { ...options, redirect: 'error', signal: AbortSignal.timeout(12000) });
}
