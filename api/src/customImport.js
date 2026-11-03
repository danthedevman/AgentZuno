import https from 'node:https';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { sourceError } from './connectors/http.js';

export function endpointUrl(value, base) {
  let url;
  if (typeof value !== 'string' || !value || value.length > 2000)
    throw sourceError('Enter a valid HTTPS API endpoint.', 400);
  try {
    url = new URL(value, base);
  } catch {
    throw sourceError('Enter a valid HTTPS API endpoint.', 400);
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443') ||
    (base && url.origin !== new URL(base).origin)
  )
    throw sourceError(
      'Use a public HTTPS endpoint on port 443. Pagination must stay on the same origin.',
      400,
    );
  return url;
}

export function isPublicAddress(address) {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === 'unicast' && parsed.toString() !== '168.63.129.16';
  } catch {
    return false;
  }
}

export function endpointHeaders(input) {
  const type = input.authentication || 'none';
  const secret = input.secret;
  if (type === 'none') return {};
  if (typeof secret !== 'string' || !secret || secret.length > 4096 || /[\r\n]/.test(secret))
    throw sourceError('Enter a valid API credential.', 400);
  if (type === 'bearer') return { Authorization: `Bearer ${secret}` };
  if (type === 'api-key') {
    if (
      !/^[a-zA-Z][a-zA-Z0-9-]{0,63}$/.test(input.headerName || '') ||
      [
        'host',
        'connection',
        'content-length',
        'transfer-encoding',
        'cookie',
        'proxy-authorization',
      ].includes(input.headerName.toLowerCase())
    )
      throw sourceError('Enter a valid API key header name.', 400);
    return { [input.headerName]: secret };
  }
  if (
    type === 'basic' &&
    typeof input.username === 'string' &&
    input.username.length > 0 &&
    input.username.length <= 254 &&
    !/[:\r\n]/.test(input.username)
  )
    return {
      Authorization: `Basic ${Buffer.from(`${input.username}:${secret}`).toString('base64')}`,
    };
  throw sourceError('Choose a supported authentication method.', 400);
}

async function requestJson(url, headers) {
  let addresses;
  try {
    addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
  } catch {
    throw sourceError('The API hostname could not be resolved.', 422);
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address)))
    throw sourceError('Private, local, and reserved API addresses are not allowed.', 400);
  // Pin the validated address so DNS cannot change between validation and connection.
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: { ...headers, Accept: 'application/json', 'Accept-Encoding': 'identity' },
        agent: false,
        signal: AbortSignal.timeout(12000),
        lookup: (_hostname, options, callback) => {
          const address = addresses[0];
          if (options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.destroy();
          reject(sourceError('The API must return HTTP 200. Redirects are not followed.', 422));
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 4 * 1024 * 1024) request.destroy(new Error('Response too large'));
          else chunks.push(chunk);
        });
        response.on('error', () => reject(sourceError('The API response could not be read.', 422)));
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(sourceError('The API must return valid JSON.', 422));
          }
        });
      },
    );
    request.on('error', () =>
      reject(sourceError('The API request failed or exceeded its time or size limit.', 422)),
    );
  });
}

export async function scanEndpoint(input, request = requestJson) {
  const first = endpointUrl(input.endpoint);
  const headers = endpointHeaders(input);
  const documents = [];
  const visited = new Set();
  let url = first;
  while (url) {
    if (visited.has(url.href) || visited.size >= 20)
      throw sourceError('API pagination repeated or exceeded 20 pages.', 422);
    visited.add(url.href);
    const data = await request(url, headers);
    const items = Array.isArray(data) ? data : data?.documents;
    if (!Array.isArray(items))
      throw sourceError(
        'Return a JSON array or an object containing documents and optional next.',
        422,
      );
    if (documents.length + items.length > 1000)
      throw sourceError('API imports support up to 1,000 documents and 4 MB total.', 422);
    documents.push(...items);
    if (documents.length > 1000 || Buffer.byteLength(JSON.stringify(documents)) > 4 * 1024 * 1024)
      throw sourceError('API imports support up to 1,000 documents and 4 MB total.', 422);
    const next = Array.isArray(data) ? null : data.next;
    if (next != null && typeof next !== 'string')
      throw sourceError('API next must be a URL string.', 422);
    url = next ? endpointUrl(next, first.href) : null;
  }
  return documents;
}
