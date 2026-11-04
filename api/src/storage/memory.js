import { BSON, ObjectId } from 'mongodb';
import { find, aggregate } from 'mingo';
import { updateDocument } from './documentUpdate.js';
const clone = (value) =>
  BSON.EJSON.deserialize(BSON.EJSON.serialize(value, { relaxed: false }), { relaxed: true });
const key = (value) => JSON.stringify(BSON.EJSON.serialize(value, { relaxed: false }));
const settings = { scriptEnabled: false };
export function createMemoryDatabase() {
  const records = new Map(),
    indexes = new Map();
  const rows = (name) => {
    if (!records.has(name)) records.set(name, []);
    return records.get(name);
  };
  function unique(name, record, ignore) {
    for (const index of [
      { fields: { _id: 1 }, options: { unique: true } },
      ...(indexes.get(name) || []),
    ]) {
      if (
        !index.options.unique ||
        (index.options.partialFilterExpression &&
          !find([record], index.options.partialFilterExpression, {}, settings).all().length)
      )
        continue;
      const fields = Object.keys(index.fields);
      const values = aggregate(
        [record],
        [{ $project: Object.fromEntries(fields.map((field) => [field, 1])) }],
        settings,
      )[0];
      if (
        rows(name).some(
          (other) =>
            other !== ignore &&
            (!index.options.partialFilterExpression ||
              find([other], index.options.partialFilterExpression, {}, settings).all().length) &&
            fields.every(
              (field) =>
                key(
                  aggregate([other], [{ $project: { value: '$' + field } }], settings)[0]?.value ??
                    null,
                ) ===
                key(
                  aggregate([values], [{ $project: { value: '$' + field } }], settings)[0]?.value ??
                    null,
                ),
            ),
        )
      )
        throw Object.assign(new Error('Duplicate demo record.'), { code: 11000 });
    }
  }
  function cursor(load, projection) {
    let sort,
      skip = 0,
      limit;
    const result = {
      sort(value) {
        sort = value;
        return result;
      },
      skip(value) {
        skip = value;
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
        let q = find(clone(load()), {}, projection, settings);
        if (sort) q = q.sort(sort);
        if (skip) q = q.skip(skip);
        if (limit) q = q.limit(limit);
        return q.all();
      },
      async next() {
        return (await result.limit(1).toArray())[0] || null;
      },
      async *[Symbol.asyncIterator]() {
        yield* await result.toArray();
      },
    };
    return result;
  }
  function collection(name) {
    const selected = (filter = {}) => find(rows(name), filter, {}, settings).all();
    function write(filter, modifier, options = {}, many = false, remove = false) {
      let selectedRows = selected(filter);
      if (options.sort)
        selectedRows = find(selectedRows, {}, {}, settings).sort(options.sort).all();
      if (!many) selectedRows = selectedRows.slice(0, 1);
      const before = selectedRows[0] ? clone(selectedRows[0]) : null,
        matched = selectedRows.length;
      let inserted = null,
        modified = 0,
        after = null;
      if (!matched && options.upsert && !remove) {
        const base = Object.fromEntries(
          Object.entries(filter).filter(
            ([field, value]) =>
              !field.startsWith('$') &&
              !(value && typeof value === 'object' && !(value instanceof ObjectId)),
          ),
        );
        selectedRows = [
          {
            ...base,
            ...modifier.$setOnInsert,
            _id: base._id || modifier.$setOnInsert?._id || new ObjectId(),
          },
        ];
        inserted = selectedRows[0]._id;
      }
      for (const record of selectedRows) {
        if (remove) {
          records.set(
            name,
            rows(name).filter((item) => item !== record),
          );
          continue;
        }
        const next = clone(record);
        const changes = Object.fromEntries(
          Object.entries(modifier).filter(([field]) => field !== '$setOnInsert'),
        );
        if (Object.keys(changes).length)
          updateDocument(next, changes, options.arrayFilters || [], settings, filter);
        unique(name, next, record);
        after = next;
        if (key(next) !== key(record)) modified++;
        if (inserted) rows(name).push(next);
        else rows(name).splice(rows(name).indexOf(record), 1, next);
      }
      return {
        acknowledged: true,
        matchedCount: matched,
        modifiedCount: modified,
        deletedCount: remove ? matched : 0,
        upsertedId: inserted,
        upsertedCount: inserted ? 1 : 0,
        value: options.returnDocument === 'after' ? clone(after) : before,
      };
    }
    const api = {
      find(filter = {}, options = {}) {
        return cursor(() => selected(filter), options.projection);
      },
      async findOne(filter = {}, options = {}) {
        let q = api.find(filter, options);
        if (options.sort) q.sort(options.sort);
        return q.next();
      },
      async countDocuments(filter = {}) {
        return selected(filter).length;
      },
      async insertOne(record) {
        record._id ||= new ObjectId();
        unique(name, record);
        rows(name).push(clone(record));
        return { acknowledged: true, insertedId: record._id };
      },
      async insertMany(items) {
        const insertedIds = {};
        for (const [index, item] of items.entries())
          insertedIds[index] = (await api.insertOne(item)).insertedId;
        return { acknowledged: true, insertedCount: items.length, insertedIds };
      },
      async updateOne(filter, modifier, options) {
        return write(filter, modifier, options);
      },
      async updateMany(filter, modifier, options) {
        return write(filter, modifier, options, true);
      },
      async findOneAndUpdate(filter, modifier, options) {
        return write(filter, modifier, options).value;
      },
      async deleteOne(filter) {
        return write(filter, {}, {}, false, true);
      },
      async deleteMany(filter) {
        return write(filter, {}, {}, true, true);
      },
      async findOneAndDelete(filter) {
        return write(filter, {}, {}, false, true).value;
      },
      aggregate(pipeline) {
        return cursor(() =>
          aggregate(rows(name), pipeline, { ...settings, collectionResolver: rows }),
        );
      },
      async createIndex(fields, options = {}) {
        const list = indexes.get(name) || [];
        if (!list.some((index) => key(index.fields) === key(fields))) {
          list.push({ fields, options });
          indexes.set(name, list);
        }
        return name;
      },
    };
    return api;
  }
  return {
    collection,
    async close() {},
    async command() {
      return { ok: 1 };
    },
    clear() {
      records.clear();
      indexes.clear();
    },
    mapRecords(transform) {
      for (const [name, items] of records) records.set(name, items.map(transform));
    },
  };
}
