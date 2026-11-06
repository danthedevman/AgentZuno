import { For, Show, createResource } from 'solid-js';
import A from '../WorkspaceLink.jsx';
import Skeleton from '../Skeleton.jsx';
import WorkflowFormNode from './WorkflowFormNode.jsx';
import { api } from '../../services/api.js';

const actionNames = {
  'task.create': 'Create fulfillment task',
  'task.wait': 'Wait for fulfillment',
  'data.read': 'Read data record',
  'data.create': 'Create data record',
  'data.update': 'Update data record',
  'data.delete': 'Review record deletion',
  route: 'Route request',
  handoff: 'Hand off to support',
  approval: 'Request approval',
  'servicenow.createIncident': 'Create ServiceNow incident',
  'slack.postMessage': 'Notify Slack channel',
  'jira.createIssue': 'Create Jira ticket',
};

export default function WorkflowVisual(props) {
  const hasNamedApprovers = () =>
    props.canManage &&
    props.definition?.steps.some(
      (step) => step.action === 'approval' && step.params.target !== 'manager',
    );
  const [visualApprovers] = createResource(hasNamedApprovers, () => api('/api/helpdesk/members'));
  const [visualApprovalGroups] = createResource(
    () =>
      hasNamedApprovers() &&
      props.definition?.steps.some(
        (step) => step.action === 'approval' && step.params.target === 'group',
      ),
    () =>
      api(
        `/api/helpdesk/approval-groups?reference=1${props.workflow?.demoDatasetId ? '&includeDemo=1' : ''}`,
      ),
  );
  const approverLabel = (id) =>
    (!visualApprovers.error && visualApprovers()?.find((person) => person.userId === id))?.name ||
    (!visualApprovers.error && visualApprovers()?.find((person) => person.userId === id))?.email ||
    'Approver';
  return (
    <>
      <div class="workflow-visual-toolbar" role="group" aria-label="Workflow zoom">
        <span class="workflow-state">
          {props.definition ? (props.workflow?.enabled ? 'Published' : 'Draft') : ''}
        </span>
        <div class="workflow-zoom-controls">
          <button
            type="button"
            class="workspace-button secondary small"
            aria-label="Zoom out"
            disabled={!props.definition || props.zoom <= 50}
            onClick={() => props.onZoomChange((value) => value - 25)}
          >
            −
          </button>
          <output aria-live="polite" aria-label="Zoom level">
            {props.zoom}%
          </output>
          <button
            type="button"
            class="workspace-button secondary small"
            aria-label="Zoom in"
            disabled={!props.definition || props.zoom >= 150}
            onClick={() => props.onZoomChange((value) => value + 25)}
          >
            +
          </button>
        </div>
      </div>
      <Show
        when={props.definition}
        fallback={
          <div class="workflow-empty">
            <p>Your workflow will appear here as you build it with the Admin agent.</p>
          </div>
        }
      >
        {(value) => (
          <>
            <ol class="workflow-nodes" style={{ zoom: props.zoom / 100 }}>
              <li class="workflow-node trigger">
                <span>Receive request</span>
                <strong>{value().form?.title || value().name}</strong>
              </li>
              <Show when={value().form}>{(form) => <WorkflowFormNode form={form()} />}</Show>
              <For each={value().routing || []}>
                {(rule) => (
                  <li class="workflow-node">
                    <span>Choose the right support team</span>
                    <strong>{rule.queueName}</strong>
                    <p>
                      If{' '}
                      {rule.conditions
                        .map(
                          (condition) =>
                            `${value().form?.fields.find((field) => field.id === condition.fieldId)?.label || condition.fieldId} ${condition.operator === 'equals' ? 'is' : 'is not'} ${String(condition.value)}`,
                        )
                        .join(rule.match === 'all' ? ' and ' : ' or ')}
                    </p>
                    <small>{rule.action === 'handoff' ? 'Handoff' : 'Route Request'}</small>
                  </li>
                )}
              </For>
              <For each={value().steps}>
                {(step) => (
                  <li class="workflow-node">
                    <span>{actionNames[step.action]}</span>
                    <strong>
                      {step.action.startsWith('data.')
                        ? `${step.params.fields.length} permitted fields`
                        : step.action === 'task.wait'
                          ? 'Continue after the fulfillment task is complete'
                          : ['route', 'handoff'].includes(step.action)
                            ? step.params.queueName
                            : step.action === 'task.create'
                              ? `${step.params.title} · ${step.params.queueName}`
                              : step.action === 'approval'
                                ? step.params.reason
                                : step.action === 'slack.postMessage'
                                  ? 'Send a message to the support channel'
                                  : 'Complete the next step'}
                    </strong>
                    <Show when={step.action === 'approval'}>
                      <div class="workflow-approver-list">
                        <small>Approvers</small>
                        <Show
                          when={step.params.target === 'manager'}
                          fallback={
                            <Show
                              when={
                                !visualApprovers.loading &&
                                (step.params.target !== 'group' || !visualApprovalGroups.loading)
                              }
                              fallback={<Skeleton label="Loading approvers" lines={1} />}
                            >
                              <ul>
                                <Show
                                  when={step.params.target === 'group'}
                                  fallback={
                                    <li>
                                      <A href={`/workspace/users/${step.params.userId}`}>
                                        {approverLabel(step.params.userId)}
                                      </A>
                                    </li>
                                  }
                                >
                                  <li>
                                    <A href={`/workspace/users/groups/${step.params.groupId}`}>
                                      {(
                                        !visualApprovalGroups.error &&
                                        visualApprovalGroups()?.find(
                                          (group) => group.id === step.params.groupId,
                                        )
                                      )?.name || 'Approval Group'}
                                    </A>
                                  </li>
                                </Show>
                              </ul>
                            </Show>
                          }
                        >
                          <ul>
                            <li>Requester’s Manager</li>
                          </ul>
                        </Show>
                      </div>
                    </Show>
                  </li>
                )}
              </For>
            </ol>
          </>
        )}
      </Show>
    </>
  );
}
