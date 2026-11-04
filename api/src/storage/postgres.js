import pg from 'pg';
import { BSON, ObjectId } from 'mongodb';
import { find, aggregate } from 'mingo';
import { updateDocument } from './documentUpdate.js';
import { createHash } from 'node:crypto';

const encode = (value) => BSON.EJSON.serialize(value, { relaxed: false });
const decode = (value) => BSON.EJSON.deserialize(value, { relaxed: true });
const key = (value) => JSON.stringify(encode(value));
const clone = (value) => decode(encode(value));
const identifier = (name) => 'az_' + createHash('sha256').update(name).digest('hex').slice(0, 24);
const queryOptions = { scriptEnabled: false, useStrictMode: true };
const fail = (error) => {
  if (error.code === '23505') error.code = 11000;
  throw error;
};

// Keep the application document contract in PostgreSQL JSONB. Existing authorization
// filters and version checks remain shared by both engines, including background jobs.
export function createPostgresDatabase(connection) {
  const pool = new pg.Pool({
    ...connection,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', () => {});
  const tables = new Map();
  async function ensure(name) {
    if (!tables.has(name))
      tables.set(
        name,
        (async () => {
          const table = identifier(name);
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['schema:' + table]);
            await client.query(
              `CREATE TABLE IF NOT EXISTS ${table} (id text PRIMARY KEY, doc jsonb NOT NULL)`,
            );
            await client.query(
              `CREATE INDEX IF NOT EXISTS ${table}_scope ON ${table} ((doc->>'ownerId'), (doc->>'workspaceId'))`,
            );
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          } finally {
            client.release();
          }
          return table;
        })().catch((error) => {
          tables.delete(name);
          throw error;
        }),
      );
    return tables.get(name);
  }
  // Push immutable ID/scope constraints into SQL; the shared query evaluator handles
  // nested arrays and expression filters before sorting, pagination or aggregation.
  function where(filter, values) {
    const clauses = [];
    for (const [field, value] of Object.entries(filter || {})) {
      if (field === '$and') {
        for (const part of value) clauses.push(where(part, values));
        continue;
      }
      if (
        ![
          '_id',
          'ownerId',
          'workspaceId',
          'userId',
          'providerOwnerId',
          'requestId',
          'tableId',
        ].includes(field)
      )
        continue;
      if (
        value === undefined ||
        value === null ||
        (typeof value === 'object' && !(value instanceof ObjectId))
      )
        continue;
      values.push(field === '_id' ? key(value) : JSON.stringify(encode(value)));
      clauses.push(
        field === '_id' ? `id = $${values.length}` : `doc->'${field}' = $${values.length}::jsonb`,
      );
    }
    return clauses.filter(Boolean).join(' AND ') || 'TRUE';
  }
  async function rows(name, filter, client = pool, lock = false) {
    const table = await ensure(name),
      params = [];
    const result = await client.query(
      `SELECT doc FROM ${table} WHERE ${where(filter, params)}${lock ? ' FOR UPDATE' : ''}`,
      params,
    );
    return result.rows.map((row) => decode(row.doc));
  }
  function cursor(load, projection) {
    let sort,
      offset = 0,
      limit;
    const result = {
      sort(value) {
        sort = value;
        return result;
      },
      skip(value) {
        offset = value;
        return result;
      },
      limit(value) {
        limit = value;
        return result;
      },
      project(value) {
        projection = value;
        return result;
      },
      async toArray() {
        let selected = find(await load(), {}, projection, queryOptions);
        if (sort) selected = selected.sort(sort);
        if (offset) selected = selected.skip(offset);
        if (limit) selected = selected.limit(limit);
        return selected.all();
      },
      async next() {
        return (await result.limit(1).toArray())[0] || null;
      },
      async *[Symbol.asyncIterator]() {
        for (const row of await result.toArray()) yield row;
      },
    };
    return result;
  }
  function collection(name) {
    const select = async (filter = {}, client, lock) =>
      find(await rows(name, filter, client, lock), filter, {}, queryOptions).all();
    async function transaction(action) {
      const table = await ensure(name),
        client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Collection-local locks also serialize absent-row upserts across API/worker pools.
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [table]);
        const value = await action(client, table);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK');
        return fail(error);
      } finally {
        client.release();
      }
    }
    async function write(filter, modifier, options = {}, many = false, remove = false) {
      return transaction(async (client, table) => {
        let selected = await select(filter, client, true);
        if (options.sort) selected = find(selected, {}, {}, queryOptions).sort(options.sort).all();
        if (!many) selected = selected.slice(0, 1);
        const before = selected[0] ? clone(selected[0]) : null;
        const matched = selected.length;
        let inserted = null,
          modified = 0;
        if (!selected.length && options.upsert && !remove) {
          const base = Object.fromEntries(
            Object.entries(filter).filter(
              ([field, value]) =>
                !field.startsWith('$') &&
                !(
                  value &&
                  typeof value === 'object' &&
                  !(value instanceof ObjectId) &&
                  !(value instanceof Date)
                ),
            ),
          );
          selected = [
            {
              ...base,
              ...(modifier.$setOnInsert || {}),
              _id: base._id || modifier.$setOnInsert?._id || new ObjectId(),
            },
          ];
          inserted = selected[0]._id;
        }
        for (const record of selected) {
          if (remove) {
            await client.query(`DELETE FROM ${table} WHERE id=$1`, [key(record._id)]);
            continue;
          }
          const original = key(record);
          const changes = Object.fromEntries(
            Object.entries(modifier).filter(([field]) => field !== '$setOnInsert'),
          );
          if (Object.keys(changes).some((field) => !field.startsWith('$')))
            throw new Error('Replacement updates require replaceOne.');
          if (Object.keys(changes).length)
            updateDocument(record, changes, options.arrayFilters || [], queryOptions, filter);
          if (key(record) !== original) modified++;
          await client.query(
            `INSERT INTO ${table} (id,doc) VALUES ($1,$2::jsonb) ON CONFLICT (id) DO UPDATE SET doc=EXCLUDED.doc`,
            [key(record._id), JSON.stringify(encode(record))],
          );
        }
        return {
          acknowledged: true,
          matchedCount: matched,
          modifiedCount: modified,
          deletedCount: remove ? matched : 0,
          upsertedCount: inserted ? 1 : 0,
          upsertedId: inserted,
          value: options.returnDocument === 'after' ? selected[0] || null : before,
        };
      });
    }
    const api = {
      find(filter = {}, options = {}) {
        return cursor(() => select(filter), options.projection);
      },
      async findOne(filter = {}, options = {}) {
        const query = api.find(filter, options);
        if (options.sort) query.sort(options.sort);
        return query.next();
      },
      async countDocuments(filter = {}) {
        return (await select(filter)).length;
      },
      async insertOne(record) {
        record._id ||= new ObjectId();
        try {
          const table = await ensure(name);
          await pool.query(`INSERT INTO ${table} (id,doc) VALUES ($1,$2::jsonb)`, [
            key(record._id),
            JSON.stringify(encode(record)),
          ]);
        } catch (error) {
          fail(error);
        }
        return { acknowledged: true, insertedId: record._id };
      },
      async insertMany(records) {
        const insertedIds = {};
        for (const [index, record] of records.entries())
          insertedIds[index] = (await api.insertOne(record)).insertedId;
        return { acknowledged: true, insertedCount: records.length, insertedIds };
      },
      async updateOne(filter, modifier, options) {
        return write(filter, modifier, options);
      },
      async updateMany(filter, modifier, options) {
        return write(filter, modifier, options, true);
      },
      async findOneAndUpdate(filter, modifier, options) {
        return (await write(filter, modifier, options)).value;
      },
      async deleteOne(filter) {
        return write(filter, {}, {}, false, true);
      },
      async deleteMany(filter) {
        return write(filter, {}, {}, true, true);
      },
      async findOneAndDelete(filter) {
        return (await write(filter, {}, {}, false, true)).value;
      },
      aggregate(pipeline) {
        return cursor(async () => {
          const resolver = new Map();
          for (const stage of pipeline)
            if (stage.$lookup)
              resolver.set(
                stage.$lookup.from,
                await rows(stage.$lookup.from, stage.$lookup.pipeline?.[0]?.$match || {}),
              );
          return aggregate(await rows(name, pipeline[0]?.$match || {}), pipeline, {
            ...queryOptions,
            collectionResolver: (source) => resolver.get(source) || [],
          });
        });
      },
      async createIndex(fields, options = {}) {
        const table = await ensure(name);
        if (!options.unique && !options.expireAfterSeconds) return table;
        if (options.expireAfterSeconds !== undefined) {
          const field = Object.keys(fields)[0];
          if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(field)) throw new Error('Invalid expiry field.');
          const cleanup = () =>
            pool
              .query(
                `DELETE FROM ${table} WHERE (doc->'${field}'->'$date'->>'$numberLong')::numeric < $1`,
                [Date.now() - options.expireAfterSeconds * 1000],
              )
              .catch(() => {});
          await cleanup();
          const timer = setInterval(cleanup, 60000);
          timer.unref();
          expiryTimers.add(timer);
          return table;
        }
        const index = identifier(name + JSON.stringify(fields));
        const expressions = Object.keys(fields).map((field) => {
          if (!/^[a-zA-Z][a-zA-Z0-9_.]*$/.test(field)) throw new Error('Invalid index field.');
          return `(COALESCE(doc #> '{${field.split('.').join(',')}}', 'null'::jsonb))`;
        });
        // The current partial unique indexes only constrain presence/type of scalar fields.
        const partial = Object.entries(options.partialFilterExpression || {}).map(
          ([field, condition]) => {
            if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(field))
              throw new Error('Unsupported partial index.');
            if (typeof condition === 'string')
              return `doc->>'${field}' = '${condition.replaceAll("'", "''")}'`;
            if (condition.$type !== 'string') throw new Error('Unsupported partial index.');
            return `jsonb_typeof(doc->'${field}') = 'string'`;
          },
        );
        await pool.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS ${index} ON ${table} (${expressions.join(',')})${partial.length ? ' WHERE ' + partial.join(' AND ') : ''}`,
        );
        return index;
      },
    };
    return api;
  }
  const expiryTimers = new Set();
  return {
    collection,
    async command() {
      await pool.query('SELECT 1');
      return { ok: 1 };
    },
    async close() {
      for (const timer of expiryTimers) clearInterval(timer);
      await pool.end();
    },
  };
}
