import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

function key() {
  const value = Buffer.from(process.env.CREDENTIAL_ENCRYPTION_KEY || '', 'base64');
  if (value.length !== 32)
    throw Object.assign(new Error('Configure the credential encryption key on the API server.'), {
      status: 503,
    });
  return value;
}
export function encryptSecret(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}
export function decryptSecret(value) {
  const cipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(value.iv, 'base64'));
  cipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([
    cipher.update(Buffer.from(value.ciphertext, 'base64')),
    cipher.final(),
  ]).toString('utf8');
}
