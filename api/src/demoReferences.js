import { helpdeskScope, deny } from './helpdeskRoles.js';

const referenceCollections = [
  'approvalGroups',
  'workforceReferences',
  'records',
  'users',
  'helpdeskMembers',
  'helpdeskWorkflows',
  'articles',
  'helpdeskRequests',
  'helpdeskTasks',
];
const rootCollections = [
  'helpdeskWorkflows',
  'articles',
  'records',
  'approvalGroups',
  'workforceProfiles',
  'workforceReferences',
  'adminDataRecords',
  'helpdeskRequests',
  'helpdeskTasks',
  'helpdeskSettings',
];
const scopeFor = (scope, name) =>
  name === 'users' ? { ownerId: scope.ownerId, demoWorkspaceId: scope.workspaceId } : scope;
function strings(value, result = new Set()) {
  if (typeof value === 'string') result.add(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, result);
  else if (value && Object.getPrototypeOf(value) === Object.prototype)
    for (const [key, item] of Object.entries(value))
      if (
        !['_id', 'ownerId', 'workspaceId', 'demoDatasetId', 'demoIndustry', 'demoSeedKey'].includes(
          key,
        )
      )
        strings(item, result);
  return result;
}
export async function demoReferences(store, user) {
  const scope = helpdeskScope(user);
  const rows = await Promise.all(
    referenceCollections.map(async (collection) =>
      (
        await store
          .collection(collection)
          .find({ ...scopeFor(scope, collection), demoDatasetId: { $exists: true } })
          .toArray()
      ).map((record) => ({
        collection,
        record,
        keys: [
          String(record._id),
          record.id,
          record.userId,
          ...(collection === 'approvalGroups' ? [record.name] : []),
        ].filter(Boolean),
      })),
    ),
  );
  return rows.flat();
}
export async function requireCompatibleDemoReferences(store, user, source, values) {
  if (source?.demoDatasetId) return;
  const selected = strings(values);
  if (
    (await demoReferences(store, user)).some((item) => item.keys.some((key) => selected.has(key)))
  )
    deny('Choose real records for this item. Demo records can only be used by demo items.', 400);
}
export async function demoRetentionPlan(store, user) {
  const scope = helpdeskScope(user),
    candidates = await demoReferences(store, user);
  const roots = (
    await Promise.all(
      rootCollections.map((name) =>
        store
          .collection(name)
          .find({ ...scope, demoDatasetId: { $exists: false } })
          .toArray(),
      ),
    )
  ).flat();
  const referenced = new Set();
  for (const row of roots) strings(row, referenced);
  const retained = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of candidates) {
      if (retained.has(item) || !item.keys.some((key) => referenced.has(key))) continue;
      retained.add(item);
      strings(item.record, referenced);
      changed = true;
    }
  }
  // Access policies follow retained knowledge records so converting a reference never broadens access.
  const ids = [...retained].map((item) => String(item.record._id));
  for (const record of await store
    .collection('knowledgePermissions')
    .find({ ...scope, demoDatasetId: { $exists: true } })
    .toArray())
    if (ids.some((id) => strings(record).has(id)))
      retained.add({ collection: 'knowledgePermissions', record });
  return [...retained];
}
export async function retainDemoReferences(store, user, plan) {
  const scope = helpdeskScope(user);
  for (const { collection, record } of plan)
    await store.collection(collection).updateOne(
      { ...scopeFor(scope, collection), _id: record._id, demoDatasetId: record.demoDatasetId },
      {
        $unset: { demo: '', demoDatasetId: '', demoIndustry: '', demoSeedKey: '' },
        $set: {
          retainedFromDemo: { datasetId: record.demoDatasetId, at: new Date(), actorId: user.id },
          updatedAt: new Date(),
        },
      },
    );
}
