import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { auditDetails } from './auditDetails.js';
export const auditContext = new AsyncLocalStorage();
const writes = new Set([
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'bulkWrite',
]);
const keyNames = (value) =>
  Object.keys(value || {})
    .filter((key) => /^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(key))
    .slice(0, 50);
export function auditDatabase(database) {
  return new Proxy(database, {
    get(target, key) {
      if (key !== 'collection') {
        const value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (name, ...options) => {
        const collection = target.collection(name, ...options);
        if (name === 'governanceAudit') return collection;
        return new Proxy(collection, {
          get(source, method) {
            const perform = source[method];
            if (!writes.has(method))
              return typeof perform === 'function' ? perform.bind(source) : perform;
            return async (...args) => {
              const request = auditContext.getStore()?.request;
              const actor = request?.helpdeskUser || request?.user;
              const record = Array.isArray(args[0]) ? args[0][0] : args[0] || {};
              const update = args[1] || {};
              const previous =
                record._id && !['insertOne', 'insertMany'].includes(method)
                  ? await source.findOne(args[0], {
                      projection: {
                        ownerId: 1,
                        workspaceId: 1,
                        version: 1,
                        workflowId: 1,
                        workflowName: 1,
                        requestId: 1,
                        name: 1,
                      },
                    })
                  : null;
              const ownerId =
                actor?.helpdeskOwnerId ||
                actor?.id ||
                record.ownerId ||
                previous?.ownerId ||
                update.$setOnInsert?.ownerId ||
                (name === 'users' ? record.id : name === 'sessions' ? record.user?.id : null) ||
                null;
              const workspaceId =
                actor?.workspaceId ||
                record.workspaceId ||
                previous?.workspaceId ||
                update.$setOnInsert?.workspaceId ||
                record.user?.workspaceId ||
                null;
              const id = randomUUID();
              const audit = target.collection('governanceAudit');
              const details = auditDetails({
                triggerType: 'record-update',
                triggerLabel: `${name}.${method}`,
                workflowId:
                  name === 'helpdeskWorkflows'
                    ? String(record._id || '')
                    : record.workflowId || previous?.workflowId,
                workflowName:
                  name === 'helpdeskWorkflows'
                    ? record.name || previous?.name
                    : record.workflowName || previous?.workflowName,
                requestId:
                  name === 'helpdeskRequests'
                    ? String(record._id || '')
                    : record.requestId || previous?.requestId,
                ...auditContext.getStore()?.details,
              });
              await audit.insertOne({
                _id: id,
                ownerId,
                workspaceId,
                actorId: actor?.id || null,
                actorType: auditContext.getStore()?.actorType || (actor ? 'account' : 'system'),
                role: actor?.role,
                actualRole: actor?.actualRole || actor?.role,
                isImpersonating: actor?.isImpersonating === true,
                method: 'DATABASE',
                action: `${name}.${method}`,
                target: name,
                ...details,
                requestAuditId: auditContext.getStore()?.auditId || null,
                rootAuditId:
                  auditContext.getStore()?.rootAuditId || auditContext.getStore()?.auditId || null,
                changedFields: [
                  ...new Set([
                    ...keyNames(update.$set),
                    ...keyNames(update.$unset),
                    ...keyNames(update.$inc),
                    ...keyNames(update.$push),
                    ...keyNames(update.$addToSet),
                    ...keyNames(update.$pull),
                    ...(method === 'insertOne' || method === 'replaceOne' ? keyNames(record) : []),
                  ]),
                ].slice(0, 50),
                versionBefore: Number.isInteger(record.version)
                  ? record.version
                  : (previous?.version ?? null),
                startedAt: new Date(),
                outcome: 'started',
              });
              try {
                const result = await perform.apply(source, args);
                await audit.updateOne(
                  { _id: id },
                  {
                    $set: {
                      outcome: 'completed',
                      ...(name === 'helpdeskWorkflows' && (record._id || result?.insertedId)
                        ? { workflowId: String(record._id || result.insertedId) }
                        : {}),
                      completedAt: new Date(),
                      matchedCount: result?.matchedCount ?? null,
                      modifiedCount: result?.modifiedCount ?? null,
                      deletedCount: result?.deletedCount ?? null,
                      insertedCount: result?.insertedCount ?? (result?.insertedId ? 1 : null),
                      resourceId:
                        name === 'sessions'
                          ? null
                          : String(
                              result?.insertedId || result?._id || record._id || record.id || '',
                            ).slice(0, 80),
                      versionAfter: Number.isInteger(result?.version)
                        ? result.version
                        : Number.isInteger(update.$set?.version)
                          ? update.$set.version
                          : Number.isInteger(update.$inc?.version) &&
                              Number.isInteger(previous?.version) &&
                              result?.matchedCount > 0
                            ? previous.version + update.$inc.version
                            : null,
                    },
                  },
                );
                return result;
              } catch (error) {
                await audit.updateOne(
                  { _id: id },
                  { $set: { outcome: 'denied-or-failed', completedAt: new Date() } },
                );
                throw error;
              }
            };
          },
        });
      };
    },
  });
}
