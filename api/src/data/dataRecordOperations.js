import { ObjectId } from 'mongodb';
import { createHash } from 'node:crypto';
import { createAdminData } from './adminData.js';
import { helpdeskScope, requireRole, deny } from '../identity/helpdeskRoles.js';

const recordId = (id) => typeof id === 'string' && /^[a-f0-9]{24}$/.test(id);
export function dataRecordValues(fields) {
  if (
    !Array.isArray(fields) ||
    fields.length > 20 ||
    new Set(fields.map((item) => item?.fieldId)).size !== fields.length
  )
    deny('Choose up to 20 unique fields.', 400);
  return Object.fromEntries(
    fields.map((item) => {
      if (
        !item ||
        typeof item !== 'object' ||
        Array.isArray(item) ||
        Object.keys(item).some((key) => !['fieldId', 'value'].includes(key)) ||
        typeof item.fieldId !== 'string' ||
        !/^[a-z][a-z0-9-]{0,39}$/.test(item.fieldId) ||
        !['string', 'number', 'boolean'].includes(typeof item.value) ||
        (typeof item.value === 'string' && item.value.length > 2000) ||
        (typeof item.value === 'number' && !Number.isFinite(item.value))
      )
        deny('Invalid record field.', 400);
      return [item.fieldId, item.value];
    }),
  );
}
export function createDataRecordOperations(store) {
  const data = createAdminData(store);
  async function read(user, tableId, id) {
    requireRole(user, ['admin']);
    if (
      typeof tableId !== 'string' ||
      !/^(ref-[a-z-]{1,60}|[a-f0-9]{24})$/.test(tableId) ||
      !recordId(id)
    )
      deny('Invalid data record.', 400);
    const row = (await data.records(user, tableId)).find((item) => item.id === id);
    if (!row) deny('Record not found.', 404);
    return row;
  }
  async function mutate(user, tableId, operation, id, values, version, key) {
    if (user?.role !== 'admin') deny('Administrator access is required.', 403);
    requireRole(user, ['admin']);
    if (
      !['create', 'update'].includes(operation) ||
      !values ||
      typeof values !== 'object' ||
      Array.isArray(values)
    )
      deny('Invalid record operation.', 400);
    const definition = await data.table(user, tableId);
    if (definition.sourceManaged) deny('Use the dedicated service for this managed record.', 409);
    if (operation === 'update' && (!recordId(id) || !Number.isSafeInteger(version) || version < 0))
      deny('Choose a record and its current version.', 400);
    const current = operation === 'update' ? await read(user, tableId, id) : null;
    if (current?.demoDatasetId) deny('Automated record mutations require real records.', 409);
    const input = {
      values: { ...(current?.values || {}), ...values },
      ...(current ? { version } : {}),
    };
    const result = await data.saveRecord(
      user,
      tableId,
      operation === 'create' ? null : id,
      input,
      key ? { key } : undefined,
    );
    return {
      id: result.id,
      version: result.version || 1,
      href: `/workspace/data/${tableId}/records/${result.id}`,
    };
  }
  async function prepareDelete(user, tableId, id, version, key, workflow) {
    if (user?.role !== 'admin') deny('Administrator access is required.', 403);
    requireRole(user, ['admin']);
    const definition = await data.table(user, tableId),
      current = await read(user, tableId, id);
    if (definition.sourceManaged)
      deny('Managed system records must use their dedicated service.', 409);
    if (!Number.isSafeInteger(version) || current.version !== version)
      deny('Record changed. Reload before deleting.', 409);
    if (current.demoDatasetId) deny('Remove tagged demo data through Settings.', 409);
    const proposalId = createHash('sha256')
      .update(key || `${user.id}:${tableId}:${id}:${version}`)
      .digest('hex')
      .slice(0, 24);
    const scope = helpdeskScope(user);
    await store.collection('dataRecordDeletions').updateOne(
      { _id: new ObjectId(proposalId), ...scope },
      {
        $setOnInsert: {
          ...scope,
          actorId: user.id,
          tableId,
          recordId: id,
          version,
          name: current.values.name || current.values.title || id,
          state: 'pending',
          createdAt: new Date(),
          ...(workflow ? { workflow } : {}),
        },
      },
      { upsert: true },
    );
    return {
      proposalId,
      requiresConfirmation: true,
      href: `/workspace/data/${tableId}/records/${id}?delete=${proposalId}`,
      message: 'Review this record and confirm deletion. Nothing has been deleted.',
    };
  }
  async function deletion(user, id) {
    requireRole(user, ['admin']);
    if (!recordId(id)) deny('Deletion review not found.', 404);
    const row = await store
      .collection('dataRecordDeletions')
      .findOne({ ...helpdeskScope(user), _id: new ObjectId(id) });
    if (!row || (row.actorId !== user.id && !row.workflow)) deny('Deletion review not found.', 404);
    await read(user, row.tableId, row.recordId);
    return row;
  }
  async function confirmDelete(user, id, input) {
    if (user?.role !== 'admin') deny('Administrator access is required.', 403);
    if (
      !input ||
      Object.keys(input).some((key) => !['confirmed', 'name'].includes(key)) ||
      input.confirmed !== true
    )
      deny('Confirm record deletion.', 400);
    const proposal = await deletion(user, id);
    if (proposal.state !== 'pending' || input.name !== proposal.name)
      deny('Confirm the current record name.', 409);
    const current = await read(user, proposal.tableId, proposal.recordId),
      definition = await data.table(user, proposal.tableId);
    if (current.version !== proposal.version) deny('Record changed. Review deletion again.', 409);
    // Do not leave live foreign-key selections pointing to a removed record.
    for (const table of await data.tables(user))
      for (const field of table.fields.filter(
        (field) => field.referenceTable === proposal.tableId,
      )) {
        if (
          (await data.records(user, table.id)).some(
            (row) => row.id !== current.id && row.values[field.id] === current.id,
          )
        )
          deny('Another record references this record. Update that reference first.', 409);
      }
    if (proposal.workflow) {
      const run = await store.collection('workflowRuns').findOne({
        ...helpdeskScope(user),
        _id: proposal.workflow.runId,
        status: 'awaiting-record-confirmation',
      });
      const step = run?.definition.steps.find(
        (item) => item.id === proposal.workflow.stepId && item.action === 'data.delete',
      );
      const executed = run?.steps.find(
        (item) =>
          item.id === proposal.workflow.stepId && item.status === 'awaiting-record-confirmation',
      );
      if (!step || !executed || executed.input.recordId !== proposal.recordId)
        deny('Workflow deletion review changed.', 409);
      const { authorizeWorkflowRun } = await import('../workflows/workflowAccess.js');
      const { workflowDataActor } = await import('../workflows/workflowDataActions.js');
      await authorizeWorkflowRun(store, run);
      await workflowDataActor(store, run, step, executed.input);
    }
    const claim = await store
      .collection('dataRecordDeletions')
      .updateOne(
        { _id: proposal._id, ...helpdeskScope(user), state: 'pending' },
        { $set: { state: 'confirming', confirmedBy: user.id, confirmedAt: new Date() } },
      );
    if (!claim.modifiedCount) deny('Deletion review changed.', 409);
    const collection = definition.system ? 'workforceReferences' : 'adminDataRecords';
    const filter = {
      ...helpdeskScope(user),
      _id: definition.system ? proposal.recordId : new ObjectId(proposal.recordId),
      ...(definition.system ? {} : { tableId: proposal.tableId }),
      ...(proposal.version ? { version: proposal.version } : { version: { $exists: false } }),
    };
    const result = await store.collection(collection).updateOne(filter, {
      $set: {
        archived: true,
        deletedAt: new Date(),
        deletedBy: user.id,
        deletionProposalId: String(proposal._id),
      },
      $inc: { version: 1 },
    });
    if (!result.modifiedCount) deny('Record changed before deletion.', 409);
    await store
      .collection('dataRecordDeletions')
      .updateOne({ _id: proposal._id }, { $set: { state: 'complete', completedAt: new Date() } });
    if (proposal.workflow)
      await store.collection('workflowRuns').updateOne(
        {
          ...helpdeskScope(user),
          _id: proposal.workflow.runId,
          status: 'awaiting-record-confirmation',
          steps: {
            $elemMatch: { id: proposal.workflow.stepId, status: 'awaiting-record-confirmation' },
          },
        },
        {
          $set: {
            'steps.$.status': 'complete',
            'steps.$.result': { deleted: true, id: proposal.recordId },
            'steps.$.completedAt': new Date(),
            status: 'queued',
            updatedAt: new Date(),
          },
        },
      );
    return { deleted: true, tableId: proposal.tableId };
  }
  return { read, mutate, prepareDelete, deletion, confirmDelete };
}
