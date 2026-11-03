import { randomBytes } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { isIP } from 'node:net';
import { resolveTxt, resolveCname } from 'node:dns/promises';
import { requireRole, helpdeskScope } from './helpdeskRoles.js';
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status, publicMessage: message });
};
export function portalHostname(value, subdomain = true) {
  if (typeof value !== 'string' || value.length > 253 || /[\s/:?#@\\]/.test(value))
    fail('Enter a hostname such as help.company.com.');
  const name = domainToASCII(value.toLowerCase().replace(/\.$/, ''));
  if (
    !name ||
    isIP(name) ||
    name.split('.').length < (subdomain ? 3 : 2) ||
    !name.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    /\.(localhost|local|internal|invalid|test|example)$/.test(name)
  )
    fail('Use a public subdomain such as help.company.com.');
  return name;
}
async function boundedDns(operation) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS timeout')), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function createCustomDomains(store, dns = { resolveTxt, resolveCname }) {
  const cache = new Map();
  const collection = () => store.collection('customDomains');
  const target = () => {
    try {
      return portalHostname(process.env.CUSTOM_DOMAIN_TARGET, false);
    } catch {
      return null;
    }
  };
  async function check(record) {
    try {
      const records = await boundedDns(dns.resolveTxt(`_zuno-verification.${record.domain}`));
      const owned =
        Array.isArray(records) &&
        records.length <= 256 &&
        records.some(
          (parts) => Array.isArray(parts) && parts.join('') === `zuno-verification=${record.token}`,
        );
      let routed = false;
      if (owned && target()) {
        try {
          const names = await boundedDns(dns.resolveCname(record.domain));
          routed =
            Array.isArray(names) &&
            names.some((name) => name.toLowerCase().replace(/\.$/, '') === target());
        } catch {
          routed = false;
        }
      }
      return { owned, routed };
    } catch {
      return { owned: false, routed: false };
    }
  }
  function safe(record) {
    return {
      domain: record?.domain || '',
      verified: record?.verified === true,
      enabled: record?.enabled === true,
      verifiedAt: record?.verifiedAt || null,
      dnsReady: record?.dnsReady === true,
      hostingConfigured: !!target() && process.env.COOKIE_SECURE === 'true',
      target: target(),
      txtName: record ? `_zuno-verification.${record.domain}` : '',
      txtValue: record ? `zuno-verification=${record.token}` : '',
    };
  }
  async function get(user) {
    requireRole(user, ['admin']);
    return safe(await collection().findOne(helpdeskScope(user)));
  }
  async function save(user, input) {
    requireRole(user, ['admin']);
    if (!input || Object.keys(input).some((key) => key !== 'domain'))
      fail('Unsupported domain setting.');
    const domain = portalHostname(input.domain);
    if (
      domain === new URL(process.env.APP_ORIGIN || 'http://localhost:3000').hostname ||
      domain === target()
    )
      fail('Choose your own portal subdomain.');
    const existing = await collection().findOne(helpdeskScope(user));
    if (existing?.domain === domain) return safe(existing);
    try {
      await collection().updateOne(
        helpdeskScope(user),
        {
          $set: {
            domain,
            token: randomBytes(24).toString('hex'),
            enabled: false,
            verified: false,
            dnsReady: false,
            verifiedAt: null,
            updatedAt: new Date(),
          },
          $setOnInsert: helpdeskScope(user),
        },
        { upsert: true },
      );
    } catch (error) {
      if (error.code === 11000) fail('This domain is already configured.', 409);
      throw error;
    }
    cache.clear();
    return get(user);
  }
  async function verify(user, enabled) {
    requireRole(user, ['admin']);
    const record = await collection().findOne(helpdeskScope(user));
    if (!record) fail('Add a domain first.', 404);
    const result = await check(record);
    await collection().updateOne(
      { _id: record._id, token: record.token },
      {
        $set: {
          verified: result.owned,
          dnsReady: result.routed,
          verifiedAt: result.owned ? new Date() : null,
          ...(!result.owned || !result.routed ? { enabled: false } : {}),
        },
      },
    );
    cache.clear();
    if (!result.owned)
      fail('The DNS verification TXT record was not found. Check the record and try again.', 409);
    if (enabled !== undefined) {
      if (enabled && (!result.routed || !target() || process.env.COOKIE_SECURE !== 'true'))
        fail(
          'Configure the CNAME target, HTTPS at your hosting provider, and secure cookies before enabling this portal.',
          409,
        );
      await collection().updateOne({ _id: record._id, token: record.token }, { $set: { enabled } });
    }
    return get(user);
  }
  async function disable(user) {
    requireRole(user, ['admin']);
    await collection().updateOne(helpdeskScope(user), { $set: { enabled: false } });
    cache.clear();
    return get(user);
  }
  async function remove(user) {
    requireRole(user, ['admin']);
    await collection().deleteOne(helpdeskScope(user));
    cache.clear();
    return safe(null);
  }
  async function resolve(host) {
    if (!process.env.MONGODB_URI) return null;
    const record = await collection().findOne({ domain: host });
    if (!record) return null;
    if (!record.enabled || !record.verified || process.env.COOKIE_SECURE !== 'true' || !target())
      fail('This portal domain is not enabled.', 421);
    const key = `${record.domain}:${record.token}:${target()}`;
    let result = cache.get(key);
    if (!result || result.expiresAt < Date.now()) {
      result = { ...(await check(record)), expiresAt: Date.now() + 60000 };
      cache.set(key, result);
    }
    if (!result.owned || !result.routed) fail('Portal DNS verification failed.', 421);
    return { domain: record.domain, workspaceId: record.workspaceId };
  }
  return { get, save, verify, disable, remove, resolve };
}
export function installCustomDomainRoutes(app, service) {
  app.get('/api/helpdesk/domain', async (req, res) =>
    res.json(await service.get(req.helpdeskUser)),
  );
  app.put('/api/helpdesk/domain', async (req, res) =>
    res.json(await service.save(req.helpdeskUser, req.body)),
  );
  app.post('/api/helpdesk/domain/verify', async (req, res) => {
    if (!req.body || Object.keys(req.body).length) fail('Unsupported verification setting.');
    res.json(await service.verify(req.helpdeskUser));
  });
  app.put('/api/helpdesk/domain/enabled', async (req, res) => {
    if (
      !req.body ||
      Object.keys(req.body).some((key) => key !== 'enabled') ||
      typeof req.body.enabled !== 'boolean'
    )
      fail('Choose whether to enable the portal.');
    if (req.body.enabled) return res.json(await service.verify(req.helpdeskUser, true));
    res.json(await service.disable(req.helpdeskUser));
  });
  app.delete('/api/helpdesk/domain', async (req, res) =>
    res.json(await service.remove(req.helpdeskUser)),
  );
}
