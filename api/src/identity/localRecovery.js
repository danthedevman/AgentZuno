import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { queryString } from '../shared/queryValues.js';
import { isEmailAddress } from '../shared/emailAddress.js';
import { auditOperation } from '../audit/audit.js';

const deriveKey = promisify(scrypt);

export async function recoverLocalAccount(store, email, password) {
  if (typeof email !== 'string' || email.length > 254 || !isEmailAddress(email.trim()))
    throw new Error('Enter a valid account email.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 200)
    throw new Error('Use a password between 12 and 200 characters.');
  const user = await store
    .collection('users')
    .findOne({ email: queryString(email.trim().toLowerCase(), 254) });
  if (!user || user.isDemo || user.identityOnly || !user.passwordHash || !user.salt)
    throw new Error(
      'A local password account was not found. Identity accounts must recover through their identity provider.',
    );
  const id = queryString(user.id, 24);
  const workspaceId = queryString(user.workspaceId, 24);
  const salt = randomBytes(16).toString('hex');
  const passwordHash = (await deriveKey(password, salt, 64)).toString('hex');
  await auditOperation(
    store,
    { id: 'local-recovery', ownerId: id, workspaceId, role: 'admin' },
    'auth.local-recovery',
    `/accounts/${id}`,
    async () => {
      const result = await store.collection('users').updateOne(
        { id, email: queryString(user.email, 254), salt: queryString(user.salt, 64) },
        {
          $set: {
            salt,
            passwordHash,
            sessionVersion: randomBytes(32).toString('hex'),
            passwordChangedAt: new Date(),
          },
        },
      );
      if (result.matchedCount !== 1) throw new Error('The account changed. Start recovery again.');
      // The version check also rejects sessions created by an already-in-flight old-password login.
      await store.collection('sessions').deleteMany({ 'user.id': queryString(id, 24) });
    },
  );
}
