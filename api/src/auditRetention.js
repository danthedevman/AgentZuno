import { randomUUID } from 'node:crypto';
import { helpdeskScope, requireRole, deny } from './helpdeskRoles.js';
import { auditOperation } from './audit.js';

const hour = 60 * 60 * 1000;
const present = (record) => ({
  enabled: record?.enabled === true,
  retentionDays: record?.retentionDays || 365,
  version: record?.version || 0,
  lastCleanupAt: record?.lastCleanupAt || null,
  lastDeletedCount: record?.lastDeletedCount || 0,
});
export function createAuditRetention(store) {
  const settings = () => store.collection('auditRetentionSettings');
  async function read(user) {
    requireRole(user, ['admin']);
    return present(await settings().findOne(helpdeskScope(user)));
  }
  async function save(user, input) {
    if (user.role !== 'admin') deny();
    if (
      !input ||
      Array.isArray(input) ||
      typeof input !== 'object' ||
      Object.keys(input).some(
        (key) => !['enabled', 'retentionDays', 'version', 'confirmed'].includes(key),
      ) ||
      typeof input.enabled !== 'boolean' ||
      !Number.isSafeInteger(input.retentionDays) ||
      input.retentionDays < 1 ||
      input.retentionDays > 3650 ||
      !Number.isSafeInteger(input.version) ||
      input.version < 0 ||
      (input.confirmed !== undefined && typeof input.confirmed !== 'boolean')
    )
      deny('Invalid audit retention settings.', 400);
    const scope = helpdeskScope(user),
      previous = await settings().findOne(scope);
    if ((previous?.version || 0) !== input.version)
      deny('Audit settings changed. Reload before saving.', 409);
    if (
      input.enabled &&
      (!previous?.enabled || input.retentionDays !== previous.retentionDays) &&
      input.confirmed !== true
    )
      deny('Confirm permanent cleanup before enabling or changing retention.', 400);
    const value = {
      ...scope,
      enabled: input.enabled,
      retentionDays: input.retentionDays,
      version: input.version + 1,
      updatedAt: new Date(),
      updatedBy: user.id,
      nextCleanupAt: new Date(Date.now() + hour),
    };
    if (previous) {
      const saved = await settings().updateOne(
        { ...scope, version: input.version },
        { $set: value },
      );
      if (!saved.matchedCount) deny('Audit settings changed. Reload before saving.', 409);
    } else {
      try {
        await settings().insertOne({ ...value, createdAt: new Date() });
      } catch (error) {
        if (error.code === 11000) deny('Audit settings changed. Reload before saving.', 409);
        throw error;
      }
    }
    return read(user);
  }
  async function cleanup(now = new Date()) {
    const due = await settings()
      .find({ enabled: true, nextCleanupAt: { $lte: now } })
      .limit(20)
      .toArray();
    for (const policy of due) {
      const lease = randomUUID(),
        scope = { ownerId: policy.ownerId, workspaceId: policy.workspaceId };
      const claimed = await settings().findOneAndUpdate(
        {
          ...scope,
          enabled: true,
          version: policy.version,
          $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }],
        },
        { $set: { lease, leaseUntil: new Date(now.getTime() + 5 * 60 * 1000) } },
        { returnDocument: 'after' },
      );
      if (!claimed) continue;
      try {
        await auditOperation(
          store,
          { id: 'audit-retention', ...scope },
          'audit-retention-cleanup',
          '/audit-retention',
          async () => {
            if (
              !(await settings().findOne({
                ...scope,
                enabled: true,
                version: policy.version,
                lease,
              }))
            )
              return { status: 'cancelled' };
            const cutoff = new Date(now.getTime() - policy.retentionDays * 86400000);
            const old = await store
              .collection('governanceAudit')
              .find(
                {
                  ...scope,
                  startedAt: { $lt: cutoff },
                  completedAt: { $lt: cutoff },
                  outcome: { $ne: 'started' },
                },
                { projection: { _id: 1 } },
              )
              .sort({ startedAt: 1 })
              .limit(1000)
              .toArray();
            const removed = old.length
              ? await store.collection('governanceAudit').deleteMany({
                  ...scope,
                  _id: { $in: old.map((record) => record._id) },
                  completedAt: { $lt: cutoff },
                  outcome: { $ne: 'started' },
                })
              : { deletedCount: 0 };
            await settings().updateOne(
              { ...scope, version: policy.version, lease },
              {
                $set: {
                  lastCleanupAt: now,
                  lastDeletedCount: removed.deletedCount,
                  nextCleanupAt: new Date(now.getTime() + (old.length === 1000 ? 60000 : hour)),
                },
              },
            );
            return removed;
          },
          {
            triggerType: 'audit-retention',
            triggerLabel: 'Explicitly enabled audit retention policy',
          },
        );
      } finally {
        await settings().updateOne({ ...scope, lease }, { $unset: { lease: '', leaseUntil: '' } });
      }
    }
  }
  return { read, save, cleanup };
}
export function installAuditRetentionRoutes(app, store) {
  const service = createAuditRetention(store);
  app.get('/api/helpdesk/audit-retention', async (request, response) =>
    response.json(await service.read(request.helpdeskUser)),
  );
  app.put('/api/helpdesk/audit-retention', async (request, response) =>
    response.json(await service.save(request.helpdeskUser, request.body)),
  );
}
