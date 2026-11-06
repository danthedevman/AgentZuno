import { ObjectId } from 'mongodb';
import { helpdeskScope, requireRole, deny } from '../identity/helpdeskRoles.js';
import { queryString, queryVersion } from '../shared/queryValues.js';

const configKeys = [
  'name',
  'department',
  'keywords',
  'action',
  'queueName',
  'definition',
  'source',
];
const configuration = (record) =>
  Object.fromEntries(
    configKeys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]),
  );
export async function archiveWorkflowVersion(store, record, actorId) {
  if (!record?.version || !record.source) return;
  const workflowId = String(record._id);
  await store.collection('workflowVersions').updateOne(
    {
      ...helpdeskScope({ id: record.ownerId, workspaceId: record.workspaceId }),
      workflowId: queryString(workflowId, 24),
      version: queryVersion(record.version),
    },
    {
      $setOnInsert: {
        _id: `${record.workspaceId}:${workflowId}:${record.version}`,
        config: configuration(record),
        savedAt: record.updatedAt || record.createdAt,
        savedBy: actorId || null,
        publishedAtSave: record.enabled && record.publishedRevision === record.version,
      },
    },
    { upsert: true },
  );
}
export function createWorkflowVersions(store, workflows) {
  async function current(user, id) {
    requireRole(user, ['admin']);
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) deny('Invalid workflow.', 400);
    const record = await store
      .collection('helpdeskWorkflows')
      .findOne({ ...helpdeskScope(user), _id: new ObjectId(id) });
    if (!record) deny('Workflow not found.', 404);
    return record;
  }
  async function read(user, id, revision) {
    const record = await current(user, id);
    const version = queryVersion(revision);
    if (version === record.version) return { record, config: configuration(record), version };
    const filter = { ...helpdeskScope(user), workflowId: queryString(id, 24) };
    const saved = await store.collection('workflowVersions').findOne({ ...filter, version });
    const published =
      !saved &&
      (await store.collection('workflowRevisions').findOne({ ...filter, revision: version }));
    if (!saved && !published) deny('Workflow version not found.', 404);
    return { record, config: configuration((saved || published).config), version };
  }
  async function list(user, id) {
    const record = await current(user, id);
    const filter = { ...helpdeskScope(user), workflowId: queryString(id, 24) };
    const [saved, published] = await Promise.all([
      store
        .collection('workflowVersions')
        .find(filter, { projection: { config: 0 } })
        .sort({ version: -1 })
        .limit(200)
        .toArray(),
      store
        .collection('workflowRevisions')
        .find(filter, { projection: { config: 0 } })
        .sort({ revision: -1 })
        .limit(200)
        .toArray(),
    ]);
    const rows = new Map(
      published.map((row) => [
        row.revision,
        { version: row.revision, savedAt: row.createdAt, publishedAtSave: true },
      ]),
    );
    for (const row of saved) rows.set(row.version, row);
    if (!rows.has(record.version))
      rows.set(record.version, { version: record.version, savedAt: record.updatedAt });
    return [...rows.values()]
      .sort((a, b) => b.version - a.version)
      .slice(0, 200)
      .map((row) => ({
        id: String(row.version),
        version: row.version,
        savedAt: row.savedAt,
        current: row.version === record.version,
        published: record.enabled && row.version === record.publishedRevision,
        publishedAtSave: !!row.publishedAtSave,
      }));
  }
  async function restore(user, id, revision, input) {
    if (
      !input ||
      input.confirmed !== true ||
      Object.keys(input).some(
        (key) => !['confirmed', 'version', 'confirmedRemovedFieldIds'].includes(key),
      )
    )
      deny('Confirm restoring this version as a draft.', 400);
    const { config } = await read(user, id, revision);
    return workflows.save(user, id, {
      ...config,
      enabled: false,
      intent: 'draft',
      version: queryVersion(input.version),
      ...(input.confirmedRemovedFieldIds
        ? { confirmedRemovedFieldIds: input.confirmedRemovedFieldIds }
        : {}),
    });
  }
  return { list, read, restore };
}
