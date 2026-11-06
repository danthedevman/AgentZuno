import nodemailer from 'nodemailer';
import { lookup } from 'node:dns/promises';
import { isPublicAddress } from '../integrations/customImport.js';
import { decryptSecret } from '../shared/secrets.js';
import { deny } from '../identity/helpdeskRoles.js';
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
