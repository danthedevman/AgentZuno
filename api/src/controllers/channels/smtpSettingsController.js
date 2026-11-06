import { queryVersion } from '../../shared/queryValues.js';

import { encryptSecret } from '../../shared/secrets.js';
import { deny, helpdeskScope, requireRole } from '../../identity/helpdeskRoles.js';
import { smtpConfiguration, smtpTransport } from '../../channels/smtpSettings.js';
export function createSmtpSettingsController(store) {
  const getSmtp = async (request, response) => {
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
  };
  const putSmtp = async (request, response) => {
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
      !Number.isSafeInteger(input.version) ||
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
          { ...filter, version: queryVersion(input.version) },
          { $set: { credential, updatedAt: new Date() }, $inc: { version: 1 } },
        );
      if (!result.matchedCount) deny('SMTP settings changed. Reload before saving.', 409);
    }
    response.json({ saved: true, version: queryVersion(input.version) + 1 });
  };
  const postSmtpTest = async (request, response) => {
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
  };
  return { getSmtp, putSmtp, postSmtpTest };
}
