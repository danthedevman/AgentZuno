import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export const installationDirectory = () => process.env.INSTALLATION_CONFIG_DIR || '';
const file = (name) => join(installationDirectory(), name);
export const needsDatabaseSetup = () =>
  Boolean(installationDirectory()) && !existsSync(file('database.json'));
function installationKey() {
  const path = file('installation.key');
  try {
    writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const key = readFileSync(path);
  if (key.length !== 32) throw new Error('Invalid installation key.');
  return key;
}
export function initializeInstallation() {
  if (!installationDirectory()) return;
  mkdirSync(installationDirectory(), { recursive: true, mode: 0o700 });
  installationKey();
  if (needsDatabaseSetup()) {
    const path = file('setup.token');
    try {
      writeFileSync(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
}
export function setupToken() {
  return readFileSync(file('setup.token'), 'utf8').trim();
}
export function saveDatabaseConfiguration(config) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', installationKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(config)), cipher.final()]);
  writeFileSync(
    file('database.json'),
    JSON.stringify({
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: encrypted.toString('base64'),
    }),
    { flag: 'wx', mode: 0o600 },
  );
}
export function databaseConfiguration(mongoUri = process.env.MONGODB_URI) {
  if (installationDirectory() && existsSync(file('database.json'))) {
    const saved = JSON.parse(readFileSync(file('database.json'), 'utf8'));
    const decipher = createDecipheriv(
      'aes-256-gcm',
      installationKey(),
      Buffer.from(saved.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(saved.tag, 'base64'));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(saved.ciphertext, 'base64')),
        decipher.final(),
      ]).toString(),
    );
  }
  if (process.env.DATABASE_PROVIDER === 'postgres')
    return {
      provider: 'postgres',
      connection: postgresConnection(process.env.POSTGRES_URL),
      database: 'agentzuno',
    };
  return mongoUri
    ? { provider: 'mongodb', uri: mongoUri, database: process.env.MONGODB_DATABASE || 'agentzuno' }
    : null;
}
export function postgresConnection(uri) {
  const url = new URL(uri);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.search ||
    url.hash ||
    !url.hostname ||
    !/^\/[a-zA-Z0-9_-]{1,63}$/.test(url.pathname)
  )
    throw new Error('Invalid PostgreSQL connection.');
  const local = ['localhost', '127.0.0.1', '::1', '[::1]', 'postgres'].includes(url.hostname);
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    ssl: local ? false : { rejectUnauthorized: true },
  };
}
export function enableLocalInstallation() {
  if (process.env.DATABASE_SETUP_MODE === 'environment') return;
  process.env.INSTALLATION_CONFIG_DIR ||= resolve(import.meta.dirname, '../../.installation');
  initializeInstallation();
}
