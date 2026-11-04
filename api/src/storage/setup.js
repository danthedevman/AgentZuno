import { rateLimit } from 'express-rate-limit';
import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { MongoClient } from 'mongodb';
import {
  initializeInstallation,
  installationDirectory,
  needsDatabaseSetup,
  setupToken,
  saveDatabaseConfiguration,
  databaseConfiguration,
  postgresConnection,
} from './configuration.js';
import { createPostgresDatabase } from './postgres.js';
import { isAllowedBrowserOrigin } from '../browserOrigin.js';

export function installDatabaseSetupRoutes(app) {
  initializeInstallation();
  const attempts = new Map();
  app.get('/api/installation/database', (request, response) => {
    response.set('Cache-Control', 'no-store').json({
      configured: !needsDatabaseSetup(),
      provider: needsDatabaseSetup() ? null : databaseConfiguration()?.provider || 'mongodb',
      bundled: {
        mongodb: Boolean(process.env.MONGODB_URI),
        postgres: Boolean(process.env.POSTGRES_URL),
      },
    });
  });
  app.post(
    '/api/installation/database',
    rateLimit({
      windowMs: 60000,
      limit: 10,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many setup attempts. Try again in a minute.' },
    }),
    express.json({ limit: '8kb' }),
    async (request, response) => {
      response.set('Cache-Control', 'no-store');
      if (!installationDirectory() || !needsDatabaseSetup())
        return response.status(409).json({
          error: 'This installation already has a database. Changing engines requires a migration.',
        });
      if (
        request.headers['sec-fetch-site'] === 'cross-site' ||
        (request.headers.origin &&
          !isAllowedBrowserOrigin(
            request.headers.origin,
            process.env.APP_ORIGIN || 'http://localhost:3000',
          ))
      )
        return response.status(403).json({ error: 'Cross-origin setup is not allowed.' });
      const now = Date.now();
      for (const [address, attempt] of attempts) if (attempt.until < now) attempts.delete(address);
      const attempt = attempts.get(request.ip) || { count: 0, until: now + 60000 };
      attempts.set(request.ip, attempt);
      if (++attempt.count > 10)
        return response
          .status(429)
          .json({ error: 'Too many setup attempts. Try again in a minute.' });
      const input = request.body || {};
      const supplied =
        typeof input.token === 'string' && /^[a-f0-9]{64}$/.test(input.token)
          ? Buffer.from(input.token)
          : Buffer.alloc(64);
      if (!timingSafeEqual(supplied, Buffer.from(setupToken())))
        return response.status(403).json({ error: 'Enter the installation setup token.' });
      if (
        Object.keys(input).some(
          (name) => !['token', 'provider', 'mode', 'connectionString'].includes(name),
        ) ||
        !['mongodb', 'postgres'].includes(input.provider) ||
        !['bundled', 'custom'].includes(input.mode)
      )
        return response.status(400).json({ error: 'Choose a database and connection type.' });
      const uri =
        input.mode === 'bundled'
          ? process.env[input.provider === 'mongodb' ? 'MONGODB_URI' : 'POSTGRES_URL']
          : input.connectionString;
      if (typeof uri !== 'string' || uri.length > 4096 || /[\x00-\x20\x7f]/u.test(uri))
        return response.status(400).json({ error: 'Enter a valid database connection string.' });
      let config, connection;
      try {
        if (input.provider === 'postgres') {
          config = { provider: 'postgres', connection: postgresConnection(uri) };
          connection = createPostgresDatabase(config.connection);
          await connection.command({ ping: 1 });
          // Exercise real read/write permissions before committing the installation choice.
          const probe = connection.collection('installationChecks');
          await probe.createIndex({ name: 1 }, { unique: true });
          const result = await probe.insertOne({ name: 'setup-' + now, at: new Date() });
          await probe.deleteOne({ _id: result.insertedId });
        } else {
          if (!/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new Error('Invalid MongoDB URI.');
          const url = new URL(uri);
          const database = url.pathname.slice(1) || 'agentzuno';
          if (!/^[a-zA-Z0-9_-]{1,63}$/.test(database)) throw new Error('Invalid database name.');
          config = { provider: 'mongodb', uri, database };
          const client = new MongoClient(uri, {
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 5000,
          });
          connection = { close: () => client.close() };
          const db = client.db(database);
          await db.command({ ping: 1 });
          const result = await db.collection('installationChecks').insertOne({ at: new Date() });
          await db.collection('installationChecks').deleteOne({ _id: result.insertedId });
        }
        saveDatabaseConfiguration(config);
        response.json({ configured: true, provider: input.provider });
      } catch (error) {
        if (error.code === 'EEXIST')
          return response.status(409).json({
            error: 'Database setup was completed by another administrator. Reload to continue.',
          });
        response.status(400).json({
          error:
            'Unable to initialize this database. Check its address, database name, credentials, TLS certificate, and read/write permissions.',
        });
      } finally {
        await connection?.close();
      }
    },
  );
}
