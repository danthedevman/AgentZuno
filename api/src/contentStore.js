import { createStorageClient } from './storage/index.js';
import { randomUUID } from 'node:crypto';
import { auditDatabase } from './recordAudit.js';
import { ObjectId, Binary } from 'mongodb';

export function createContentStore(uri = process.env.MONGODB_URI, databaseOverride) {
  const client = databaseOverride
    ? { configured: true, db: () => databaseOverride, close: async () => {} }
    : createStorageClient(uri);
  const database = () => {
    if (!client) throw Object.assign(new Error('MongoDB is not configured.'), { status: 503 });
    return auditDatabase(client.db(process.env.MONGODB_DATABASE || 'agentzuno'));
  };

  return {
    async articles(ownerId, metadataOnly = false) {
      if (!client.configured) return [];
      const records = await database()
        .collection('articles')
        .find({ ownerId }, metadataOnly ? { projection: { body: 0, sections: 0, content: 0 } } : {})
        .sort({ updatedAt: -1 })
        .toArray();
      return records.map(({ _id, ownerId, ...article }) => ({ ...article, id: _id.toHexString() }));
    },
    async saveArticle(ownerId, article, id) {
      article = { ...article, semanticGeneration: randomUUID(), semanticStatus: 'Pending' };
      const result = await database()
        .collection('articles')
        .insertOne({ ...article, ownerId, ...(id ? { _id: new ObjectId(id) } : {}) });
      return { ...article, id: result.insertedId.toHexString() };
    },
    async article(ownerId, id) {
      if (!ObjectId.isValid(id)) return null;
      return database()
        .collection('articles')
        .findOne({ _id: new ObjectId(id), ownerId });
    },
    async updateArticle(ownerId, id, article, expectedUpdatedAt) {
      article = { ...article, semanticGeneration: randomUUID(), semanticStatus: 'Pending' };
      if (!ObjectId.isValid(id)) return null;
      const result = await database()
        .collection('articles')
        .findOneAndUpdate(
          {
            _id: new ObjectId(id),
            ownerId,
            ...(expectedUpdatedAt === undefined ? {} : { updatedAt: expectedUpdatedAt }),
          },
          { $set: article },
          { returnDocument: 'after' },
        );
      if (!result) return null;
      const { _id, ownerId: owner, ...record } = result;
      return { ...record, id: _id.toHexString() };
    },
    async saveImage(ownerId, buffer) {
      const result = await database()
        .collection('images')
        .insertOne({ ownerId, data: new Binary(buffer), createdAt: new Date() });
      return result.insertedId.toHexString();
    },
    async image(ownerId, id) {
      if (!ObjectId.isValid(id)) return null;
      return database()
        .collection('images')
        .findOne({ _id: new ObjectId(id), ownerId });
    },
    async records(ownerId, types) {
      if (!client.configured) return [];
      const records = await database()
        .collection('records')
        .find({ ownerId, ...(types ? { type: { $in: types } } : {}) })
        .sort({ updatedAt: -1 })
        .toArray();
      return records.map(({ _id, ownerId, ...record }) => ({
        ...record,
        id: _id.toHexString(),
        editable: true,
      }));
    },
    async record(ownerId, id, type) {
      if (!ObjectId.isValid(id)) return null;
      const record = await database()
        .collection('records')
        .findOne({ _id: new ObjectId(id), ownerId, ...(type ? { type } : {}) });
      if (!record) return null;
      const { _id, ownerId: owner, ...values } = record;
      return { ...values, id: _id.toHexString() };
    },
    async updateRecord(ownerId, id, type, values) {
      if (!ObjectId.isValid(id)) return null;
      const record = await database()
        .collection('records')
        .findOneAndUpdate(
          { _id: new ObjectId(id), ownerId, type },
          { $set: values },
          { returnDocument: 'after' },
        );
      if (!record) return null;
      const { _id, ownerId: owner, ...saved } = record;
      return { ...saved, id: _id.toHexString() };
    },
    async saveRecord(ownerId, record) {
      const result = await database()
        .collection('records')
        .insertOne({ ...record, ownerId });
      return { ...record, id: result.insertedId.toHexString() };
    },
    async saveFile(ownerId, buffer, filename) {
      const result = await database()
        .collection('uploads')
        .insertOne({ ownerId, data: new Binary(buffer), filename, createdAt: new Date() });
      return result.insertedId.toHexString();
    },
    async file(ownerId, id) {
      if (!ObjectId.isValid(id)) return null;
      return database()
        .collection('uploads')
        .findOne({ _id: new ObjectId(id), ownerId });
    },
    close: () => client?.close(),
  };
}
