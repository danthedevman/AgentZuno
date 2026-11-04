import { MongoClient } from 'mongodb';
import { databaseConfiguration, needsDatabaseSetup } from './configuration.js';
import { createPostgresDatabase } from './postgres.js';

export function createStorageClient(mongoUri = process.env.MONGODB_URI) {
  const clients = new Map();
  return {
    get configured() {
      return !needsDatabaseSetup() && Boolean(databaseConfiguration(mongoUri));
    },
    db() {
      if (needsDatabaseSetup())
        throw Object.assign(new Error('Choose a database before registering.'), {
          status: 503,
          publicMessage: 'Complete database setup before creating an account.',
        });
      const config = databaseConfiguration(mongoUri);
      if (!config) throw Object.assign(new Error('Database is not configured.'), { status: 503 });
      const key = JSON.stringify(config);
      if (!clients.has(key)) {
        if (config.provider === 'postgres')
          clients.set(key, createPostgresDatabase(config.connection));
        else {
          const client = new MongoClient(config.uri, { serverSelectionTimeoutMS: 5000 });
          const database = client.db(config.database);
          clients.set(key, {
            collection: database.collection.bind(database),
            command: database.command.bind(database),
            close: () => client.close(),
          });
        }
      }
      return clients.get(key);
    },
    async close() {
      await Promise.all([...clients.values()].map((client) => client.close()));
    },
  };
}
