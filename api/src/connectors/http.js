import sanitizeHtml from 'sanitize-html';

export const plainText = (value) =>
  sanitizeHtml(String(value || ''), { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
export const sourceError = (message, status = 422) =>
  Object.assign(new Error(message), { status, publicMessage: message });
export const segment = (value) => {
  const id = String(value);
  if (!id || id.length > 200 || id === '.' || id === '..' || /[\r\n]/.test(id))
    throw sourceError('The source returned an invalid identifier.');
  return encodeURIComponent(id);
};
export const basic = (username, password) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
export function tenantHost(tenant, suffix) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(tenant || ''))
    throw sourceError('Enter a valid app subdomain.', 400);
  return `https://${tenant}.${suffix}`;
}
export function nextLink(headers) {
  return (
    headers
      .get('link')
      ?.split(',')
      .find((part) => /rel="?next"?/.test(part))
      ?.match(/<([^>]+)>/)?.[1] || null
  );
}
export function createSourceHttp(base, headers, fetcher = fetch) {
  const root = new URL(base);
  const prefix = root.pathname.replace(/\/$/, '');
  return async function request(path, options = {}) {
    const url = new URL(path, root);
    if (
      url.protocol !== 'https:' ||
      url.origin !== root.origin ||
      url.username ||
      url.password ||
      (prefix && url.pathname !== prefix && !url.pathname.startsWith(prefix + '/'))
    )
      throw sourceError('The app returned an unexpected pagination URL.');
    let response;
    try {
      response = await fetcher(url, {
        ...options,
        headers: {
          ...headers,
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw sourceError('The source could not be reached.', 503);
    }
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const delay = Number.isFinite(Number(retry))
        ? Number(retry) * 1000
        : Date.parse(retry) - Date.now();
      throw Object.assign(
        sourceError(
          [401, 403, 404].includes(response.status)
            ? 'Source access could not be verified.'
            : 'The source is unavailable or rate limited.',
          response.status === 429 ? 429 : 422,
        ),
        { retryAfter: Math.min(3600000, Math.max(1000, Number.isFinite(delay) ? delay : 30000)) },
      );
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) {
        await reader.cancel();
        throw sourceError('The source response exceeded 4 MB.');
      }
      chunks.push(Buffer.from(value));
    }
    let data;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw sourceError('The source returned invalid JSON.');
    }
    return { data, headers: response.headers };
  };
}
export async function* paginated(request, first, items, next) {
  let path = first;
  const seen = new Set();
  for (let page = 1; path; page++) {
    if (page > 1000 || seen.has(path))
      throw sourceError('Source pagination repeated or exceeded its limit.');
    seen.add(path);
    const response = await request(path);
    const values = items(response.data);
    if (!Array.isArray(values)) throw sourceError('The source returned an invalid document list.');
    yield* values;
    path = next(response, page, values);
  }
}
