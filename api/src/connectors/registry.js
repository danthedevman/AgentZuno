import { knowledgeAdapters } from './knowledgeApps.js';
import { sourceError } from './http.js';

const token = { id: 'oauth', label: 'OAuth access token', credentialLabel: 'OAuth access token' };
const key = { id: 'api-key', label: 'API key', credentialLabel: 'API key' };
const basicToken = {
  id: 'basic',
  label: 'Basic authentication · API token',
  credentialLabel: 'API token',
};
const tenant = (label, when) => ({
  name: 'tenant',
  label,
  required: true,
  pattern: '^[a-z0-9][a-z0-9-]{0,62}$',
  when,
});
const email = (when) => ({
  name: 'username',
  label: 'Email',
  type: 'email',
  required: true,
  pattern: '^[^\\s:@]+@[^\\s:@]+\\.[^\\s:@]+$',
  when,
});
export const adapterRegistry = {
  notion: {
    authenticationMethods: [token, key],
    connectionFields: [],
    sourcePermissionsSupported: false,
  },
  zendesk: {
    authenticationMethods: [token, key],
    connectionFields: [tenant('Zendesk subdomain'), email(['api-key'])],
    sourcePermissionsSupported: true,
  },
  confluence: {
    authenticationMethods: [token, basicToken],
    connectionFields: [
      {
        name: 'cloudId',
        label: 'Atlassian cloud ID',
        required: true,
        pattern: '^[a-fA-F0-9-]{36}$',
        when: ['oauth'],
      },
      tenant('Atlassian subdomain', ['basic']),
      email(['basic']),
    ],
    sourcePermissionsSupported: true,
  },
  servicenow: {
    authenticationMethods: [
      token,
      { id: 'basic', label: 'Basic authentication', credentialLabel: 'Password' },
    ],
    connectionFields: [
      tenant('ServiceNow instance subdomain'),
      {
        name: 'namespace',
        label: 'ServiceNow application namespace',
        defaultValue: 'x_agentzuno',
        required: true,
        pattern: '^x_[a-z0-9_]{1,78}$',
      },
      {
        name: 'username',
        label: 'Username',
        required: true,
        pattern: '^[a-zA-Z0-9._@-]{1,254}$',
        when: ['basic'],
      },
    ],
    sourcePermissionsSupported: true,
  },
  ...knowledgeAdapters,
};

export function publicAdapter(provider) {
  const adapter = adapterRegistry[provider];
  if (!adapter) return { adapterImplemented: false, sourcePermissionsSupported: false };
  return {
    adapterImplemented: true,
    sourcePermissionsSupported: !!adapter.sourcePermissionsSupported,
    authenticationMethods: adapter.authenticationMethods,
    connectionFields: adapter.connectionFields,
    ...(adapter.docsUrl ? { docsUrl: adapter.docsUrl } : {}),
  };
}

export function validateAdapterConfig(provider, input, authType) {
  const adapter = adapterRegistry[provider];
  if (!adapter || !adapter.authenticationMethods.some((method) => method.id === authType))
    throw sourceError('This authentication method is not implemented for the app.', 400);
  const config = { authType };
  if (
    input.config !== undefined &&
    (!input.config || typeof input.config !== 'object' || Array.isArray(input.config))
  )
    throw sourceError('Invalid connection settings.', 400);
  for (const field of adapter.connectionFields) {
    if (field.when && !field.when.includes(authType)) continue;
    const value = input.config?.[field.name] ?? input[field.name] ?? field.defaultValue ?? '';
    if (
      typeof value !== 'string' ||
      value.length > 254 ||
      (field.required && !value.trim()) ||
      /[\r\n]/.test(value)
    )
      throw sourceError(`Enter a valid ${field.label.toLowerCase()}.`, 400);
    const clean = value.trim();
    if (
      (field.pattern && !new RegExp(field.pattern).test(clean)) ||
      (field.options && !field.options.some((option) => option.value === clean))
    )
      throw sourceError(`Choose a valid ${field.label.toLowerCase()}.`, 400);
    config[field.name] = clean;
  }
  return config;
}
