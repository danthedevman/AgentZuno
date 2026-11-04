import { confirmAction, confirmRemovedFields } from './confirmations.js';
export async function api(path, options = {}) {
  if (
    options.method === 'DELETE' &&
    !options.confirmed &&
    !(await confirmAction(
      'Delete this item? This action removes its saved configuration.',
      'Confirm Deletion',
      'Delete',
    ))
  )
    throw Object.assign(new Error('Deletion canceled.'), { canceled: true });
  const match = window.location.pathname.match(
    /^\/workspace\/([a-f0-9]{24}|demo-(?:alex|jordan))(?:\/|$)/,
  );
  const scope =
    match &&
    !path.startsWith('/api/auth/') &&
    !['/api/site', '/api/integration-catalog'].includes(path)
      ? { 'X-Workspace-Id': match[1] }
      : {};
  const isDemo = options.demo ?? /^\/demo(?:\/|$)/.test(window.location.pathname);
  const requestPath =
    isDemo && path.startsWith('/api/') && !path.startsWith('/api/demo-api/')
      ? `/api/demo-api${path}`
      : path;
  const response = await fetch(requestPath, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...scope, ...options.headers },
  });
  const body = await response.json();
  if (
    response.status === 409 &&
    Array.isArray(body.removedFields) &&
    body.removedFields.length &&
    !options.removalConfirmed
  ) {
    if (!(await confirmRemovedFields(body.removedFields, [])))
      throw Object.assign(new Error('Removal canceled.'), { canceled: true });
    return api(path, {
      ...options,
      removalConfirmed: true,
      body: JSON.stringify({
        ...JSON.parse(options.body),
        confirmedRemovedFieldIds: body.removedFields.map((field) => field.id),
      }),
    });
  }
  if (!response.ok)
    throw Object.assign(new Error(body.error || 'The request failed.'), {
      status: response.status,
    });
  if (
    !['GET', 'HEAD'].includes(options.method || 'GET') &&
    !/uploads|attachments|article-proposals$|preferences|permissions|oauth|test|recent-views/.test(
      path,
    )
  )
    window.dispatchEvent(new Event('agentzuno-form-saved'));
  return body;
}
