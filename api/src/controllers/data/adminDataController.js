import { ObjectId } from 'mongodb';

import { helpdeskScope, requireRole, deny } from '../../identity/helpdeskRoles.js';

import { listResponse } from '../../shared/listQuery.js';
import { defineDataTable, text, createAdminData } from '../../data/adminData.js';
export function createAdminDataController(store, chats) {
  const service = createAdminData(store);
  async function association(user, id) {
    requireRole(user, ['admin']);
    const value = await store
      .collection('adminDataConversations')
      .findOne({ ...helpdeskScope(user), actorId: user.id, chatId: id });
    if (!value) deny('Data conversation not found.', 404);
    return value;
  }
  const getDataTables = async (request, response) =>
    response.json(
      listResponse(
        request,
        await service.tables(request.helpdeskUser),
        {
          Table: 'name',
          Description: 'description',
          Fields: (item) => item.fields.length,
          Updated: (item) => (item.updatedAt ? Date.parse(item.updatedAt) : null),
        },
        { sort: 'Table' },
      ),
    );
  const postDataTables = async (request, response) =>
    response.status(201).json(await service.saveTable(request.helpdeskUser, null, request.body));
  const getDataTablesId = async (request, response) =>
    response.json(await service.table(request.helpdeskUser, request.params.id));
  const putDataTablesId = async (request, response) =>
    response.json(await service.saveTable(request.helpdeskUser, request.params.id, request.body));
  const getDataTablesIdOptions = async (request, response) =>
    response.json(
      await service.options(
        request.helpdeskUser,
        request.params.id,
        request.query.includeDemo === '1',
      ),
    );
  const getDataTablesIdRecords = async (request, response) => {
    const table = await service.table(request.helpdeskUser, request.params.id);
    const records = await service.records(request.helpdeskUser, request.params.id);
    const lookups = new Map();
    for (const field of table.fields.filter((field) => field.type === 'reference'))
      lookups.set(
        field.id,
        await service.options(request.helpdeskUser, field.referenceTable, true),
      );
    const rows = records.map((record) => ({
      ...record,
      labels: Object.fromEntries(
        [...lookups].map(([key, options]) => [
          key,
          options.find((item) => item.value === record.values[key])?.label || '—',
        ]),
      ),
    }));
    response.json(
      listResponse(
        request,
        rows,
        Object.fromEntries([
          ...table.fields.map((field) => [
            field.id,
            (row) => (field.type === 'reference' ? row.labels[field.id] : row.values[field.id]),
          ]),
          ['Updated', (row) => (row.updatedAt ? Date.parse(row.updatedAt) : null)],
        ]),
      ),
    );
  };
  const getDataTablesIdRecordsRecordId = async (request, response) => {
    const records = await service.records(request.helpdeskUser, request.params.id);
    const record = records.find((item) => String(item.id) === request.params.recordId);
    if (!record) deny('Record not found.', 404);
    response.json(record);
  };
  const getDataTablesRefCatalogCategoryRecordsRecordIdWorkflows = async (request, response) => {
    const user = request.helpdeskUser;
    const records = await service.records(user, 'ref-catalog-category');
    if (!records.some((record) => String(record.id) === request.params.recordId))
      deny('Category not found.', 404);
    const workflows = await store
      .collection('helpdeskWorkflows')
      .find({
        ...helpdeskScope(user),
        $or: [
          { 'definition.settings.category': request.params.recordId },
          { 'publishedConfig.definition.settings.category': request.params.recordId },
        ],
      })
      .toArray();
    response.json(
      listResponse(
        request,
        workflows.map((record) => ({
          id: String(record._id),
          name: record.name,
          status: record.enabled ? 'Published' : 'Draft',
          updatedAt: record.updatedAt,
        })),
        { Workflow: 'name', Status: 'status', Updated: (item) => Date.parse(item.updatedAt) },
      ),
    );
  };
  const deleteDataTablesId = async (request, response) => {
    const raw =
      /^[a-f0-9]{24}$/.test(request.params.id) &&
      (await store.collection('adminDataTables').findOne({
        ...helpdeskScope(request.helpdeskUser),
        _id: new ObjectId(request.params.id),
        deleting: true,
      }));
    const table = raw
      ? { ...raw, id: request.params.id }
      : await service.table(request.helpdeskUser, request.params.id);
    if (table.system) deny('Built-in data tables cannot be deleted.', 409);
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    if (table.sourceManaged) deny('Managed data tables cannot be deleted.', 409);
    if (
      request.body?.confirmed !== true ||
      request.body?.name !== table.name ||
      request.body?.version !== table.version
    )
      deny('Type the current table name and confirm deletion.', 400);
    const scope = helpdeskScope(user);
    if (
      await store.collection('adminDataTables').findOne({
        ...scope,
        _id: { $ne: new ObjectId(request.params.id) },
        archived: { $ne: true },
        'fields.referenceTable': request.params.id,
      })
    )
      deny('Remove references from other tables before deleting this table.', 409);
    const claim = await store
      .collection('adminDataTables')
      .updateOne(
        { ...scope, _id: new ObjectId(request.params.id), version: table.version },
        { $set: { archived: true, deleting: true, updatedAt: new Date() } },
      );
    if (!claim.matchedCount) deny('Table changed. Reload before deleting.', 409);
    await store.collection('adminDataRecords').deleteMany({ ...scope, tableId: request.params.id });
    await store
      .collection('adminDataConversations')
      .deleteMany({ ...scope, tableId: request.params.id });
    await store
      .collection('adminDataTables')
      .deleteOne({ ...scope, _id: new ObjectId(request.params.id), deleting: true });
    response.json({ deleted: true });
  };
  const postDataTablesIdRecords = async (request, response) =>
    response
      .status(201)
      .json(await service.saveRecord(request.helpdeskUser, request.params.id, null, request.body));
  const putDataTablesIdRecordsRecordId = async (request, response) =>
    response.json(
      await service.saveRecord(
        request.helpdeskUser,
        request.params.id,
        request.params.recordId,
        request.body,
      ),
    );
  const postDataConversations = async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const input = request.body;
    if (
      !input ||
      Object.keys(input).some((key) => !['requestId', 'text', 'definition'].includes(key))
    )
      deny('Invalid conversation fields.', 400);
    const draft = input.definition ? defineDataTable(input.definition) : null;
    const chat = await chats.create(
      user,
      { requestId: input.requestId, text: text(input.text, 4000) },
      {
        providerOwnerId: user.helpdeskOwnerId || user.id,
        assistantType: 'admin',
        helpdeskPurpose: 'workflow',
        dataDesigner: true,
        ...(draft ? { dataDraft: draft } : {}),
      },
    );
    await store.collection('adminDataConversations').updateOne(
      { ...helpdeskScope(user), actorId: user.id, chatId: chat.id },
      {
        $setOnInsert: {
          ...helpdeskScope(user),
          actorId: user.id,
          chatId: chat.id,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
    response.status(202).json(chat);
  };
  const postDataConversationsIdMessages = async (request, response) => {
    const user = request.helpdeskUser;
    await association(user, request.params.id);
    const input = request.body;
    if (!input || Object.keys(input).some((key) => !['text', 'retry', 'definition'].includes(key)))
      deny('Invalid conversation fields.', 400);
    response
      .status(202)
      .json(
        await chats.send(
          user,
          request.params.id,
          input.retry === true ? { retry: true } : { text: text(input.text, 4000) },
          input.definition ? { dataDraft: defineDataTable(input.definition) } : {},
        ),
      );
  };
  const getDataConversationsId = async (request, response) => {
    const user = request.helpdeskUser;
    const previous = await association(user, request.params.id);
    const chat = await chats.get(user, request.params.id);
    const latest = [...chat.messages].reverse().find((message) => message.role === 'assistant');
    let definition = previous.definition || null;
    if (latest?.status === 'complete') {
      try {
        definition = defineDataTable(latest.proposals?.dataTable?.definition);
        await store
          .collection('adminDataConversations')
          .updateOne({ _id: previous._id }, { $set: { definition, updatedAt: new Date() } });
      } catch {
        /* Clarifying replies may not contain a complete schema. */
      }
    }
    response.json({
      id: request.params.id,
      status: chat.status,
      messages: chat.messages,
      definition,
    });
  };
  return {
    getDataTables,
    postDataTables,
    getDataTablesId,
    putDataTablesId,
    getDataTablesIdOptions,
    getDataTablesIdRecords,
    getDataTablesIdRecordsRecordId,
    getDataTablesRefCatalogCategoryRecordsRecordIdWorkflows,
    deleteDataTablesId,
    postDataTablesIdRecords,
    putDataTablesIdRecordsRecordId,
    postDataConversations,
    postDataConversationsIdMessages,
    getDataConversationsId,
  };
}
