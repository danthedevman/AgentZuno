import { rateLimit } from 'express-rate-limit';
import nodemailer from 'nodemailer';
import { lookup } from 'node:dns/promises';
import { isPublicAddress } from './customImport.js';
import { encryptSecret, decryptSecret } from './secrets.js';
import { deny, helpdeskScope, requireRole } from './helpdeskRoles.js';
export async function smtpConfiguration(store, scope) {
  const record = await store.collection('smtpSettings').findOne(scope);
  return record?.credential
    ? { ...JSON.parse(decryptSecret(record.credential)), version: record.version }
    : null;
}
export async function smtpTransport(config) {
  const addresses = await lookup(config.host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => !isPublicAddress(item.address)))
    deny('Choose a public SMTP hostname.', 400);
  const address = addresses[0];
  return nodemailer.createTransport({
    host: address.address,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.port !== 465,
    tls: { servername: config.host, rejectUnauthorized: true },
    auth: config.username ? { user: config.username, pass: config.password } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}
export function installSmtpRoutes(app, store) {
  app.use(
    '/api/helpdesk/smtp/test',
    rateLimit({
      windowMs: 60000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many attempts. Try again in a minute.' },
    }),
  );
  app.get('/api/helpdesk/smtp', async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    const config = await smtpConfiguration(store, helpdeskScope(request.helpdeskUser));
    response.json(
      config
        ? {
            host: config.host,
            port: config.port,
            from: config.from,
            username: config.username,
            hasPassword: !!config.password,
            version: config.version,
          }
        : { host: '', port: 587, from: '', username: '', hasPassword: false, version: 0 },
    );
  });
  app.put('/api/helpdesk/smtp', async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    if (user.isDemo) deny();
    const input = request.body;
    if (
      !input ||
      Object.keys(input).some(
        (key) => !['host', 'port', 'from', 'username', 'password', 'version'].includes(key),
      ) ||
      typeof input.host !== 'string' ||
      !/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(input.host) ||
      ![465, 587].includes(input.port) ||
      typeof input.from !== 'string' ||
      input.from.length > 254 ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.from) ||
      ['username', 'password'].some(
        (key) =>
          typeof input[key] !== 'string' ||
          input[key].length > 2000 ||
          /[\x00-\x1f\x7f]/.test(input[key]),
      ) ||
      !Number.isInteger(input.version) ||
      input.version < 0
    )
      deny('Provide a valid SMTP host, TLS port, sender, and credentials.', 400);
    const scope = helpdeskScope(user);
    const previous = await smtpConfiguration(store, scope);
    if ((previous?.version || 0) !== input.version)
      deny('SMTP settings changed. Reload before saving.', 409);
    const same = previous?.host === input.host && previous?.username === input.username;
    const password = input.password || (same ? previous.password : '');
    if (input.username && !password) deny('Provide the SMTP password.', 400);
    const credential = encryptSecret(
      JSON.stringify({
        host: input.host.toLowerCase(),
        port: input.port,
        from: input.from,
        username: input.username,
        password,
      }),
    );
    const filter = { _id: JSON.stringify(scope), ...scope };
    if (!previous) {
      try {
        await store
          .collection('smtpSettings')
          .insertOne({ ...filter, credential, version: 1, updatedAt: new Date() });
      } catch (error) {
        if (error.code === 11000) deny('SMTP settings changed. Reload before saving.', 409);
        throw error;
      }
    } else {
      const result = await store
        .collection('smtpSettings')
        .updateOne(
          { ...filter, version: input.version },
          { $set: { credential, updatedAt: new Date() }, $inc: { version: 1 } },
        );
      if (!result.matchedCount) deny('SMTP settings changed. Reload before saving.', 409);
    }
    response.json({ saved: true, version: input.version + 1 });
  });
  app.post('/api/helpdesk/smtp/test', async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    const config = await smtpConfiguration(store, helpdeskScope(request.helpdeskUser));
    if (!config) deny('Save SMTP settings first.', 409);
    try {
      const transport = await smtpTransport(config);
      try {
        await transport.verify();
      } finally {
        transport.close();
      }
    } catch {
      deny(
        'SMTP connection could not be verified. Check the saved host, TLS port, and credentials.',
        422,
      );
    }
    response.json({ verified: true });
  });
}
