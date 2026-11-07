import { executeWorkflowDataAction } from './workflowDataActions.js';
import { authorizeWorkflowRun } from './workflowAccess.js';
import { validateWorkflowAction as validateAction } from './workflowActionPolicy.js';
import { workflowAuditDetails } from '../audit/auditDetails.js';
import { createRequestTasks } from '../requests/requestTasks.js';
import { slackWorkflowDestination } from './slackWorkflowDestination.js';
import { requireConnectorAction } from '../integrations/connectorActions.js';

import { resolveWorkflowApprovers, workflowRequesterContext } from '../requests/approvalTargets.js';
import { requireCurrentChannelApplication } from '../channels/channelApplications.js';
import { requireExistingQueues } from '../identity/helpdeskQueues.js';
import { ObjectId } from 'mongodb';
import { createHash, randomUUID } from 'node:crypto';
import { runSandbox } from './workflowRuntime.js';
import { validateFormAnswers, approvalConditionMatches } from '../../sdk/workflows/index.js';
import { helpdeskScope, requireRole, deny } from '../identity/helpdeskRoles.js';
import { auditOperation } from '../audit/audit.js';
import { decryptSecret } from '../shared/secrets.js';
import { fetchChannelJson } from '../channels/helpdeskChannels.js';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const paused = () => Object.assign(new Error('Workflow paused.'), { paused: true });
export const publicRun = ({
  _id,
  source,
  input,
  definition,
  ownerId,
  workspaceId,
  lease,
  leaseUntil,
  ...record
}) => ({ id: String(_id), ...record });
export function createWorkflowExecution(store, fetcher = fetch) {
  const runs = () => store.collection('workflowRuns');
  const authorize = (run) => authorizeWorkflowRun(store, run);
  async function ensureRun(request) {
    if (!request.workflowId || !ObjectId.isValid(request.workflowId)) return null;
    const workflow = await store.collection('helpdeskWorkflows').findOne({
      ownerId: request.ownerId,
      workspaceId: request.workspaceId,
      _id: new ObjectId(request.workflowId),
      enabled: true,
    });
    const revision =
      workflow &&
      (await store.collection('workflowRevisions').findOne({
        ownerId: request.ownerId,
        workspaceId: request.workspaceId,
        workflowId: request.workflowId,
        revision: request.workflowVersion,
      }));
    const published =
      revision?.config ||
      (workflow?.publishedRevision === request.workflowVersion ? workflow?.publishedConfig : null);
    if (!published?.source) return null;
    const id = hash(
      `${request.ownerId}:${request.workspaceId}:${request._id}:${request.workflowId}:${request.workflowVersion}`,
    );
    await runs().updateOne(
      { _id: id },
      {
        $setOnInsert: {
          _id: id,
          ownerId: request.ownerId,
          workspaceId: request.workspaceId,
          actorId: request.requesterId,
          workflowId: request.workflowId,
          revision: request.workflowVersion,
          requestId: String(request._id),
          source: published.source,
          publishedBy: published.publishedBy,
          definition: published.definition,
          sourceHash: hash(published.source),
          input: {
            requester: await workflowRequesterContext(store, request),
            answers: Object.fromEntries(
              (request.formSubmission?.answers || []).map((answer) => [answer.id, answer.value]),
            ),
            request: { id: String(request._id), number: request.number, title: request.title },
          },
          status: 'queued',
          steps: [],
          attempts: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
    return id;
  }
  async function test(user, source, definition, answers) {
    requireRole(user, ['admin']);
    if (definition.form) validateFormAnswers(definition.form, answers);
    const steps = [];
    await runSandbox(source, {
      input: {
        answers,
        requester: await workflowRequesterContext(store, {
          ...helpdeskScope(user),
          workspaceId: user.workspaceId,
          requesterId: user.id,
        }),
        request: { number: 'TEST', title: definition.form?.title || definition.name },
      },
      action: async ({ action, id, input }) => {
        validateAction(definition, action, id, input);
        if (steps.some((step) => step.id === id))
          deny('Step IDs must be unique in an execution.', 400);
        const declared = definition.steps.find((step) => step.id === id);
        const context = {
          answers,
          requester: await workflowRequesterContext(store, {
            ...helpdeskScope(user),
            workspaceId: user.workspaceId,
            requesterId: user.id,
          }),
        };
        steps.push({
          id,
          action,
          input,
          status:
            action === 'approval' && !approvalConditionMatches(declared.when, context)
              ? 'Skipped'
              : 'Simulated',
        });
        return action === 'approval' ? { approved: true, simulated: true } : { simulated: true };
      },
    });
    return {
      status: 'Simulated',
      steps,
      message:
        'No requests were changed and no messages were sent. Approval decisions are simulated as approved.',
    };
  }
  async function process(id) {
    const lease = randomUUID();
    const candidate = await runs().findOne({ _id: id });
    if (!candidate) return;
    const workflow = await store.collection('helpdeskWorkflows').findOne({
      _id: new ObjectId(candidate.workflowId),
      ownerId: candidate.ownerId,
      workspaceId: candidate.workspaceId,
    });
    const limit = Math.min(
      candidate.definition.settings?.maxConcurrentRuns || 2,
      workflow?.publishedConfig?.definition?.settings?.maxConcurrentRuns || 2,
    );
    let slotId;
    for (let slot = 0; slot < limit; slot++) {
      const key = `${candidate.ownerId}:${candidate.workspaceId}:${candidate.workflowId}:${slot}`;
      try {
        const acquired = await store
          .collection('workflowConcurrency')
          .updateOne(
            { _id: key, leaseUntil: { $lt: new Date() } },
            { $set: { lease, runId: id, leaseUntil: new Date(Date.now() + 120000) } },
            { upsert: true },
          );
        if (acquired.matchedCount || acquired.upsertedCount) {
          slotId = key;
          break;
        }
      } catch (error) {
        if (error.code !== 11000) throw error;
      }
    }
    if (!slotId) return;
    const run = await runs().findOneAndUpdate(
      {
        _id: id,
        $or: [{ status: 'queued' }, { status: 'running', leaseUntil: { $lt: new Date() } }],
      },
      {
        $set: {
          status: 'running',
          lease,
          leaseUntil: new Date(Date.now() + 120000),
          updatedAt: new Date(),
        },
        $inc: { attempts: 1 },
      },
      { returnDocument: 'after' },
    );
    if (!run) {
      await store.collection('workflowConcurrency').deleteOne({ _id: slotId, lease });
      return;
    }
    const filter = { _id: id, lease };
    const scope = { ownerId: run.ownerId, workspaceId: run.workspaceId };
    try {
      if (run.attempts > 50) throw new Error('Retry limit reached.');
      const request = await store.collection('helpdeskRequests').findOne({
        ...scope,
        _id: new ObjectId(run.requestId),
        requesterId: run.actorId,
        submissionState: 'submitted',
      });
      if (!request) deny();
      await authorize(run);
      const seen = new Set();
      await runSandbox(run.source, {
        timeoutMs: (run.definition.settings?.timeoutSeconds || 60) * 1000,
        input: run.input || {},
        action: async ({ action, id: stepId, input }) => {
          validateAction(run.definition, action, stepId, input);
          if (seen.has(stepId)) deny('Duplicate execution step.', 400);
          seen.add(stepId);
          const actor = await authorize(run);
          if (
            !(await store.collection('helpdeskRequests').findOne({
              ...scope,
              _id: new ObjectId(run.requestId),
              submissionState: 'submitted',
            }))
          )
            deny('Request no longer exists.', 404);
          const active = await runs().findOne(filter);
          if (!active) deny();
          const fingerprint = hash(JSON.stringify({ action, input }));
          const previous = active.steps.find((step) => step.id === stepId);
          if (previous && previous.fingerprint !== fingerprint)
            deny('Workflow replay changed a step.');
          if (previous?.status === 'complete') return previous.result;
          if (previous?.status === 'sending') {
            await runs().updateOne(filter, { $set: { status: 'delivery-unknown' } });
            throw paused();
          }
          const step = {
            id: stepId,
            action,
            input,
            fingerprint,
            requireRejectionComment:
              action === 'approval' &&
              run.definition.steps.find((item) => item.id === stepId)?.requireRejectionComment ===
                true,
            status: action === 'approval' ? 'awaiting-approval' : 'started',
            startedAt: new Date(),
          };
          if (!previous) await runs().updateOne(filter, { $push: { steps: step } });
          if (action === 'task.wait') {
            const declared = run.definition.steps.find((item) => item.id === stepId);
            const origin = active.steps.find(
              (item) =>
                item.id === declared.params.taskStepId &&
                item.action === 'task.create' &&
                item.status === 'complete',
            );
            if (!origin || origin.result.id !== input.taskId)
              deny('Only this workflow’s created task can be awaited.');
            const task = await store
              .collection('helpdeskTasks')
              .findOne({ ...scope, _id: new ObjectId(input.taskId), requestId: run.requestId });
            if (!task) deny('Task no longer exists.', 404);
            if (task.status !== 'closed') {
              await runs().updateOne(
                { ...filter, 'steps.id': stepId },
                {
                  $set: {
                    status: 'waiting-for-task',
                    'steps.$.status': 'waiting-for-task',
                    'steps.$.result': { id: input.taskId },
                    updatedAt: new Date(),
                  },
                },
              );
              throw paused();
            }
            const result = { id: input.taskId, completed: true };
            await runs().updateOne(
              { ...filter, 'steps.id': stepId },
              {
                $set: {
                  'steps.$.status': 'complete',
                  'steps.$.result': result,
                  'steps.$.completedAt': new Date(),
                },
              },
            );
            return result;
          }
          if (action === 'approval') {
            const declared = run.definition.steps.find((item) => item.id === stepId);
            if (!approvalConditionMatches(declared.when, run.input)) {
              const result = { approved: true, skipped: true };
              await runs().updateOne(
                { ...filter, 'steps.id': stepId },
                {
                  $set: {
                    'steps.$.status': 'complete',
                    'steps.$.result': result,
                    'steps.$.completedAt': new Date(),
                  },
                },
              );
              return result;
            }
            let currentApprovers;
            try {
              currentApprovers = await resolveWorkflowApprovers(store, run, input);
            } catch (error) {
              const failureReason =
                error.approvalFailureCode === 'self-approval'
                  ? 'The requester cannot approve their own request. Choose another eligible approver.'
                  : 'No eligible approver is available. Check group membership and approval permission.';
              await runs().updateOne(
                { ...filter, 'steps.id': stepId },
                {
                  $set: {
                    'steps.$.status': 'blocked',
                    'steps.$.failureReason': failureReason,
                    'steps.$.completedAt': new Date(),
                  },
                },
              );
              throw error;
            }
            const ids = previous?.resolvedUserIds
              ? previous.resolvedUserIds.filter((id) => currentApprovers.includes(id))
              : currentApprovers;
            if (!ids.length) deny('Approval assignment changed. Review this request.');
            await runs().updateOne(
              { ...filter, 'steps.id': stepId },
              { $set: { 'steps.$.resolvedUserIds': ids, 'steps.$.status': 'awaiting-approval' } },
            );
            await store.collection('helpdeskRequests').updateOne(
              { ...scope, _id: request._id },
              {
                $set: {
                  approvalUserIds: ids,
                  status: 'waiting-for-approval',
                  updatedAt: new Date(),
                },
              },
            );
            await auditOperation(
              store,
              { ...actor, ownerId: run.ownerId },
              'workflow.approval.requested',
              `/workflow-runs/${run._id}/${stepId}`,
              () => runs().updateOne(filter, { $set: { status: 'awaiting-approval' } }),
              workflowAuditDetails(run, stepId),
            );
            throw paused();
          }
          const result = await auditOperation(
            store,
            { ...actor, ownerId: run.ownerId },
            `workflow.${action}`,
            `/workflow-runs/${run._id}/${stepId}`,
            async () => {
              if (['route', 'handoff'].includes(action)) {
                await requireExistingQueues(store, actor, [input.queueName]);
                const eventId = `${run._id}:${stepId}`;
                await store.collection('helpdeskRequests').updateOne(
                  { ...scope, _id: request._id, 'events.workflowStepId': { $ne: eventId } },
                  {
                    $set: {
                      queueName: input.queueName,
                      ...(request.formSubmission
                        ? {
                            'formSubmission.routing': {
                              action,
                              queueName: input.queueName,
                              ruleId: run.definition.routing?.some((rule) => rule.id === stepId)
                                ? stepId
                                : null,
                              status: 'executed',
                            },
                          }
                        : {}),
                      status: action === 'handoff' ? 'escalated' : 'open',
                      updatedAt: new Date(),
                    },
                    $inc: { version: 1 },
                    $push: {
                      events: {
                        type: 'workflow-routed',
                        workflowStepId: eventId,
                        actorId: run.actorId,
                        at: new Date(),
                      },
                    },
                  },
                );
                return { queueName: input.queueName };
              }
              if (action.startsWith('data.')) {
                const declared = run.definition.steps.find((item) => item.id === stepId);
                const result = await executeWorkflowDataAction(store, run, declared, input);
                if (action === 'data.delete') {
                  await runs().updateOne(
                    { ...filter, 'steps.id': stepId },
                    {
                      $set: {
                        status: 'awaiting-record-confirmation',
                        'steps.$.status': 'awaiting-record-confirmation',
                        'steps.$.result': result,
                        updatedAt: new Date(),
                      },
                    },
                  );
                  throw paused();
                }
                return result;
              }
              if (action === 'task.create') {
                const task = await createRequestTasks(store).createForWorkflow(
                  run,
                  stepId,
                  input,
                  actor,
                );
                return { id: task.id, queueName: task.queueName };
              }
              const source = await store
                .collection('helpdeskChannels')
                .findOne({ ...scope, provider: 'slack', slackScopeVersion: 1 });
              if (
                !source?.credential ||
                (source.expiresAt && new Date(source.expiresAt) <= new Date())
              )
                deny('Slack must be connected.');
              await requireConnectorAction(store, source, 'workflowNotifications');
              await requireCurrentChannelApplication(store, source);
              const token = JSON.parse(decryptSecret(source.credential)).accessToken;
              if (typeof token !== 'string' || !token) deny('Slack must be reauthorized.');
              const destination = await slackWorkflowDestination(
                store,
                source,
                input.channel,
                run.actorId,
              );
              if (/^[CG]/.test(destination)) {
                const channel = await fetchChannelJson(
                  fetcher,
                  `https://slack.com/api/conversations.info?channel=${encodeURIComponent(destination)}`,
                  { headers: { Authorization: `Bearer ${token}` } },
                );
                if (!channel.ok || !channel.channel?.is_member || channel.channel?.is_archived)
                  deny('Zuno must be a member of this Slack channel.');
              }
              await authorize(run);
              const currentSource = await store.collection('helpdeskChannels').findOne({
                ...scope,
                _id: source._id,
                provider: 'slack',
                slackGeneration: source.slackGeneration,
              });
              if (
                !currentSource?.credential ||
                (currentSource.expiresAt && new Date(currentSource.expiresAt) <= new Date())
              )
                deny('Slack access changed.');
              if (
                (await slackWorkflowDestination(
                  store,
                  currentSource,
                  input.channel,
                  run.actorId,
                )) !== destination
              )
                deny('Slack recipient changed.');
              await requireConnectorAction(store, currentSource, 'workflowNotifications');
              await requireCurrentChannelApplication(store, currentSource);
              const claiming = await runs().updateOne(
                { ...filter, steps: { $elemMatch: { id: stepId, status: 'started' } } },
                { $set: { 'steps.$.status': 'sending' } },
              );
              if (!claiming.modifiedCount) throw paused();
              // Slack has no guaranteed transactional deduplication; uncertain delivery stops for review.
              const sent = await fetchChannelJson(
                fetcher,
                'https://slack.com/api/chat.postMessage',
                {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    channel: destination,
                    text: input.text
                      .replaceAll('&', '&amp;')
                      .replaceAll('<', '&lt;')
                      .replaceAll('>', '&gt;'),
                    parse: 'none',
                    mrkdwn: false,
                    link_names: false,
                    client_msg_id: hash(`${run._id}:${stepId}`).slice(0, 32),
                    unfurl_links: false,
                    unfurl_media: false,
                  }),
                },
              );
              if (!sent.ok || !sent.ts) throw new Error('Slack delivery failed.');
              return { messageId: sent.ts };
            },
            workflowAuditDetails(run, stepId),
          );
          await runs().updateOne(
            { ...filter, 'steps.id': stepId },
            {
              $set: {
                'steps.$.status': 'complete',
                'steps.$.result': result,
                'steps.$.completedAt': new Date(),
              },
            },
          );
          return result;
        },
      });
      const latest = await runs().findOne(filter);
      if (latest?.status === 'running') {
        const automatic =
          !run.definition.steps.some((step) =>
            ['route', 'handoff', 'task.create', 'task.wait'].includes(step.action),
          ) &&
          !(run.definition.routing || []).length &&
          latest.steps.some(
            (step) =>
              ['data.create', 'data.update'].includes(step.action) && step.status === 'complete',
          ) &&
          !latest.steps.some(
            (step) => step.action === 'approval' && step.result?.approved === false,
          );
        if (automatic) {
          await authorize(run);
          const eventId = `${run._id}:complete`;
          await auditOperation(
            store,
            { ...(await authorize(run)), ownerId: run.ownerId },
            'workflow.request.completed',
            `/requests/${run.requestId}`,
            () =>
              store.collection('helpdeskRequests').updateOne(
                {
                  ...scope,
                  _id: request._id,
                  submissionState: 'submitted',
                  status: { $in: ['open', 'waiting-for-approval'] },
                  'events.workflowStepId': { $ne: eventId },
                },
                {
                  $set: { status: 'resolved', updatedAt: new Date() },
                  $inc: { version: 1 },
                  $push: {
                    events: {
                      type: 'workflow-completed',
                      workflowStepId: eventId,
                      actorId: run.actorId,
                      at: new Date(),
                    },
                  },
                },
              ),
            workflowAuditDetails(run),
          );
        }
        await runs().updateOne(filter, { $set: { status: 'complete', completedAt: new Date() } });
      }
    } catch (error) {
      const latest = await runs().findOne(filter);
      if (latest?.status === 'running')
        await runs().updateOne(filter, {
          $set: {
            status: latest.steps.some((step) => step.status === 'sending')
              ? 'delivery-unknown'
              : [502, 503].includes(error.status) && run.attempts < 5
                ? 'queued'
                : 'failed',
            error: 'Workflow could not finish. Review its actions, access, and connections.',
            updatedAt: new Date(),
          },
        });
    } finally {
      await store.collection('workflowConcurrency').deleteOne({ _id: slotId, lease });
      await runs().updateOne(filter, {
        $unset: { lease: '', leaseUntil: '' },
        $set: { updatedAt: new Date() },
      });
    }
  }
  async function decide(user, id, stepId, approved, comment = '') {
    requireRole(user, ['admin', 'agent', 'user']);
    if (!user.canApprove || typeof approved !== 'boolean') deny('Approval permission is required.');
    const run = await runs().findOne({
      _id: id,
      ...helpdeskScope(user),
      status: 'awaiting-approval',
    });
    const step = run?.steps.find(
      (item) => item.id === stepId && item.status === 'awaiting-approval',
    );
    if (
      !step ||
      !(step.resolvedUserIds || [step.input.userId]).includes(user.id) ||
      run.actorId === user.id
    )
      deny('Approval not found.', 404);
    if (typeof comment !== 'string' || comment.length > 2000)
      deny('Provide a comment of up to 2,000 characters.', 400);
    if (
      !approved &&
      run.definition.steps.find((item) => item.id === stepId)?.requireRejectionComment &&
      !comment.trim()
    )
      deny('A rejection comment is required.', 400);
    await authorize(run);
    if (!(await resolveWorkflowApprovers(store, run, step.input)).includes(user.id))
      deny('Approval assignment changed.', 403);
    await auditOperation(
      store,
      { ...user, ownerId: run.ownerId },
      'workflow.approval.decided',
      `/workflow-runs/${run._id}/${stepId}`,
      async () => {
        const result = await runs().updateOne(
          {
            _id: id,
            ...helpdeskScope(user),
            status: 'awaiting-approval',
            steps: { $elemMatch: { id: stepId, status: 'awaiting-approval' } },
          },
          {
            $set: {
              'steps.$.status': 'complete',
              'steps.$.result': { approved, decidedBy: user.id, comment: comment.trim() },
              'steps.$.completedAt': new Date(),
              status: 'queued',
              updatedAt: new Date(),
            },
          },
        );
        if (!result.modifiedCount) deny('Approval changed.', 409);
        await store.collection('helpdeskRequests').updateOne(
          { ...helpdeskScope(user), _id: new ObjectId(run.requestId) },
          {
            $set: { approvalUserIds: [], status: 'open', updatedAt: new Date() },
            $inc: { version: 1 },
          },
        );
      },
      workflowAuditDetails(run, stepId, 'approval-decision'),
    );
    return { status: 'queued' };
  }
  async function recover() {
    const requests = await store
      .collection('helpdeskRequests')
      .find({
        workflowId: { $exists: true },
        workflowVersion: { $exists: true },
        workflowRunScheduled: { $ne: true },
        submissionState: 'submitted',
      })
      .limit(50)
      .toArray();
    for (const request of requests) {
      await ensureRun(request);
      await store
        .collection('helpdeskRequests')
        .updateOne({ _id: request._id }, { $set: { workflowRunScheduled: true } });
    }
    const waiting = await runs().find({ status: 'waiting-for-task' }).limit(50).toArray();
    for (const run of waiting) {
      const step = run.steps.find(
        (item) => item.action === 'task.wait' && item.status === 'waiting-for-task',
      );
      const taskId = step?.input.taskId;
      if (!ObjectId.isValid(taskId)) continue;
      const task = await store.collection('helpdeskTasks').findOne({
        ownerId: run.ownerId,
        workspaceId: run.workspaceId,
        _id: new ObjectId(taskId),
        requestId: run.requestId,
        status: 'closed',
      });
      if (task)
        await runs().updateOne(
          { _id: run._id, status: 'waiting-for-task' },
          { $set: { status: 'queued', updatedAt: new Date() } },
        );
    }
    const queued = await runs()
      .find({ $or: [{ status: 'queued' }, { status: 'running', leaseUntil: { $lt: new Date() } }] })
      .limit(20)
      .toArray();
    return queued;
  }
  return { ensureRun, process, test, decide, recover };
}
