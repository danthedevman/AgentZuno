import { createStorageClient } from './storage/index.js';
import { auditDatabase } from './recordAudit.js';
import { createHash } from 'node:crypto';

export function createAccountStore(uri = process.env.MONGODB_URI, databaseOverride) {
  const client = databaseOverride
    ? { configured: true, db: () => databaseOverride, close: async () => {} }
    : createStorageClient(uri);
  let indexes;
  const database = () => {
    if (!client) throw Object.assign(new Error('MongoDB is not configured.'), { status: 503 });
    return auditDatabase(client.db(process.env.MONGODB_DATABASE || 'agentzuno'));
  };
  const hash = (token) => createHash('sha256').update(token).digest('hex');
  async function ready() {
    indexes ||= Promise.all([
      database().collection('users').createIndex({ email: 1 }, { unique: true }),
      database().collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    ]);
    await indexes;
  }
  return {
    async findById(id) {
      return client.configured ? database().collection('users').findOne({ id }) : null;
    },
    async findUser(email) {
      return client.configured ? database().collection('users').findOne({ email }) : null;
    },
    async createUser(user) {
      await ready();
      await database().collection('users').insertOne(user);
    },
    async saveSession(token, user, expiresAt) {
      if (client.configured) {
        await ready();
        await database()
          .collection('sessions')
          .insertOne({ _id: hash(token), user, expiresAt: new Date(expiresAt) });
      }
    },
    async session(token) {
      return client.configured && token
        ? database()
            .collection('sessions')
            .findOne({ _id: hash(token), expiresAt: { $gt: new Date() } })
        : null;
    },
    async setImpersonation(token, impersonation) {
      const result = await database()
        .collection('sessions')
        .updateOne(
          { _id: hash(token), expiresAt: { $gt: new Date() } },
          impersonation ? { $set: { impersonation } } : { $unset: { impersonation: '' } },
        );
      return result.matchedCount === 1;
    },
    async deleteSession(token) {
      if (client.configured && token)
        await database()
          .collection('sessions')
          .deleteOne({ _id: hash(token) });
    },
    close: () => client?.close(),
  };
}
