import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { helpdeskScope, requireRole, deny } from '../identity/helpdeskRoles.js';
import { queryString, queryVersion } from '../shared/queryValues.js';
import { canWorkRequest } from './requestPolicy.js';
export function createUserAccess(store) {
  const records = () => store.collection('userAccess');
  async function application(user, id) {
    const record = await store.collection('workforceReferences').findOne({
      ...helpdeskScope(user),
      _id: queryString(id, 80),
      type: 'application',
    });
    if (!record) deny('Choose an application in this workspace.', 400);
    return record;
  }
  async function reserve(user, workflow, answers, offerId) {
    const config = workflow.definition?.settings?.accessTracking;
    if (!config) return null;
    requireRole(user, ['admin', 'agent', 'user']);
    const app = await application(user, config.applicationId);
    const value = answers[config.accessFieldId];
    if (typeof value !== 'string' || !value.trim() || value.length > 160)
      deny('Choose an access level.', 400);
    const accessLevel = value.trim();
    const normalized = accessLevel.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
    const id = createHash('sha256')
      .update(JSON.stringify([helpdeskScope(user), user.id, app._id, normalized]))
      .digest('hex')
      .slice(0, 24);
    const filter = { ...helpdeskScope(user), _id: new ObjectId(id) };
    const existing = await records().findOne(filter);
    if (existing?.offerId === offerId) return existing;
    if (existing && !['revoked', 'failed'].includes(existing.status))
      deny(
        `You already have ${existing.status === 'active' ? 'this access' : 'a pending request for this access'}${existing.requestNumber ? ` (${existing.requestNumber})` : ''}.`,
        409,
      );
    const values = {
      userId: queryString(user.id),
      userName: user.name || user.email || 'User',
      applicationId: String(app._id),
      applicationName: app.name,
      accessLevel,
      name: `${user.name || user.email || 'User'} · ${app.name} · ${accessLevel}`,
      status: 'requested',
      offerId: queryString(offerId, 36),
      updatedAt: new Date(),
    };
    if (existing) {
      const result = await records().updateOne(
        { ...filter, version: queryVersion(existing.version), status: existing.status },
        { $set: values, $inc: { version: 1 }, $unset: { requestId: '', requestNumber: '' } },
      );
      if (!result.matchedCount) deny('Access record changed. Try again.', 409);
    } else {
      try {
        await records().insertOne({ ...filter, ...values, version: 1, createdAt: new Date() });
      } catch (error) {
        if (error.code === 11000)
          deny('An access request is already being submitted. Try again.', 409);
        throw error;
      }
    }
    return records().findOne(filter);
  }
  async function attach(user, claim, request) {
    if (!claim) return;
    await records().updateOne(
      { ...helpdeskScope(user), _id: claim._id, offerId: queryString(claim.offerId, 36) },
      {
        $set: {
          requestId: queryString(request.id, 24),
          requestNumber: queryString(request.number, 80),
          updatedAt: new Date(),
        },
      },
    );
  }
  async function get(user, id) {
    requireRole(user, ['admin', 'agent', 'user', 'read-only']);
    if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id)) deny('Invalid access record.', 400);
    const record = await records().findOne({ ...helpdeskScope(user), _id: new ObjectId(id) });
    if (!record || (record.userId !== user.id && !['admin', 'read-only'].includes(user.role))) {
      const request =
        record?.requestId &&
        (await store
          .collection('helpdeskRequests')
          .findOne({ ...helpdeskScope(user), _id: new ObjectId(record.requestId) }));
      if (!request || !canWorkRequest(user, request)) deny('Access record not found.', 404);
    }
    const { _id, ownerId, workspaceId, offerId, ...visible } = record;
    return { id: String(_id), ...visible };
  }
  async function change(user, id, input) {
    requireRole(user, ['admin', 'agent']);
    if (
      !input ||
      input.confirmed !== true ||
      !['active', 'revoked', 'failed'].includes(input.status) ||
      Object.keys(input).some((key) => !['confirmed', 'status', 'version'].includes(key))
    )
      deny('Confirm the access change.', 400);
    const current = await get(user, id);
    const request =
      current.requestId &&
      (await store
        .collection('helpdeskRequests')
        .findOne({ ...helpdeskScope(user), _id: new ObjectId(current.requestId) }));
    if (user.role !== 'admin' && (!request || !canWorkRequest(user, request))) deny();
    if (
      input.status === 'active' &&
      (!request ||
        request.approvals?.some((item) => item.status !== 'approved') ||
        !['requested', 'provisioning'].includes(current.status))
    )
      deny('Complete the approved fulfillment before confirming access.', 409);
    if (input.status === 'active' && request) {
      const run = await store
        .collection('workflowRuns')
        .findOne({ ...helpdeskScope(user), requestId: queryString(current.requestId, 24) });
      if (
        run &&
        (run.status !== 'complete' || run.steps?.some((step) => step.result?.approved === false))
      )
        deny('Complete the authorized workflow and approvals before confirming access.', 409);
    }
    if (input.status === 'revoked' && current.status !== 'active')
      deny('Only active access can be revoked.', 409);
    if (input.status === 'failed' && !['requested', 'provisioning'].includes(current.status))
      deny('This request is no longer pending.', 409);
    const result = await records().updateOne(
      {
        ...helpdeskScope(user),
        _id: new ObjectId(id),
        version: queryVersion(input.version),
        status: current.status,
      },
      {
        $set: {
          status: input.status,
          confirmedBy: user.id,
          confirmedAt: new Date(),
          updatedAt: new Date(),
        },
        $inc: { version: 1 },
      },
    );
    if (!result.matchedCount) deny('Access record changed. Reload and retry.', 409);
    return get(user, id);
  }
  return { application, reserve, attach, get, change };
}
