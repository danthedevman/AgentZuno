import { For, Show, createResource } from 'solid-js';
import { api } from '../services/api.js';
import Dropdown from './Dropdown.jsx';
import ReferenceLookup from './ReferenceLookup.jsx';
import MultiSelectLookup from './MultiSelectLookup.jsx';
import A from './WorkspaceLink.jsx';
export default function WorkflowApprovalEditor(props) {
  const [users] = createResource(() => api('/api/helpdesk/members'));
  const [groups] = createResource(() =>
    api(`/api/helpdesk/approval-groups?reference=1${props.includeDemo ? '&includeDemo=1' : ''}`),
  );
  const [references] = createResource(() =>
    api(`/api/helpdesk/reference-records${props.includeDemo ? '?includeDemo=1' : ''}`),
  );
  const eligible = () =>
    (!users.error ? users() || [] : []).filter((user) => user.active && user.canApprove);
  const departments = () =>
    (!references.error ? references()?.references || [] : []).filter(
      (item) => item.type === 'department',
    );
  const approvals = () => props.value.steps.filter((step) => step.action === 'approval');
  const update = (id, changes) =>
    props.onChange({
      ...props.value,
      steps: props.value.steps.map((step) => (step.id === id ? { ...step, ...changes } : step)),
    });
  const conditionFields = () =>
    (props.value.form?.fields || []).filter((field) => ['select', 'boolean'].includes(field.type));
  return (
    <section class="workflow-form-editor">
      <div class="helpdesk-actions">
        <button
          type="button"
          class="workspace-button secondary small"
          disabled={props.disabled || props.value.steps.length >= 10}
          onClick={() =>
            props.onChange({
              ...props.value,
              steps: [
                {
                  id: `approval-${Date.now().toString(36)}`,
                  action: 'approval',
                  params: { target: 'manager', reason: 'Review this request' },
                },
                ...props.value.steps,
              ],
            })
          }
        >
          Add Approval
        </button>
        <A href="/workspace/users?tab=groups">Manage Groups</A>
      </div>
      <Show when={!approvals().length}>
        <p>No approval steps.</p>
      </Show>
      <For each={approvals()}>
        {(step) => (
          <details class="workflow-field-accordion">
            <summary>{step.params.reason}</summary>
            <div class="create-form workflow-form-field">
              <div class="preference-row">
                <span>Require Rejection Comment</span>
                <button
                  type="button"
                  class="toggle-switch"
                  role="switch"
                  aria-label="Require rejection comment"
                  aria-checked={step.requireRejectionComment === true}
                  onClick={() =>
                    update(step.id, { requireRejectionComment: !step.requireRejectionComment })
                  }
                >
                  <span />
                </button>
              </div>
              <label>
                Reason
                <input
                  maxlength="2000"
                  value={step.params.reason}
                  onInput={(event) =>
                    update(step.id, {
                      params: { ...step.params, reason: event.currentTarget.value },
                    })
                  }
                />
              </label>
              <label>
                Approver
                <Dropdown
                  ariaLabel="Approval target"
                  value={step.params.target || 'user'}
                  options={[
                    { value: 'manager', label: "Requester's Manager" },
                    ...(eligible().length ? [{ value: 'user', label: 'Specific User' }] : []),
                    ...((groups() || []).some((group) => group.active)
                      ? [{ value: 'group', label: 'Group' }]
                      : []),
                  ]}
                  onChange={(target) =>
                    update(step.id, {
                      params: {
                        reason: step.params.reason,
                        target,
                        ...(target === 'user'
                          ? { userId: eligible()[0].userId }
                          : target === 'group'
                            ? { groupId: groups().find((group) => group.active).id }
                            : {}),
                      },
                    })
                  }
                />
              </label>
              <Show
                when={step.params.target === 'user' || (!step.params.target && step.params.userId)}
              >
                <ReferenceLookup
                  label="User"
                  required
                  value={step.params.userId || ''}
                  options={eligible().map((user) => ({
                    value: user.userId,
                    href: `/workspace/users/${user.userId}`,
                    label: user.name || user.email,
                  }))}
                  onChange={(userId) =>
                    update(step.id, {
                      params: { reason: step.params.reason, target: 'user', userId },
                    })
                  }
                />
              </Show>
              <Show when={step.params.target === 'group'}>
                <ReferenceLookup
                  label="Group"
                  required
                  value={step.params.groupId || ''}
                  options={(groups() || [])
                    .filter((group) => group.active)
                    .map((group) => ({
                      value: group.id,
                      label: group.name,
                      href: `/workspace/users/groups/${group.id}`,
                    }))}
                  onChange={(groupId) =>
                    update(step.id, {
                      params: { reason: step.params.reason, target: 'group', groupId },
                    })
                  }
                />
                <small>Any one assigned member can decide.</small>
              </Show>
              <label>
                Require Approval
                <Dropdown
                  ariaLabel="Approval condition"
                  value={
                    step.when?.departmentIds ? 'department' : step.when?.fieldId ? 'form' : 'always'
                  }
                  options={[
                    { value: 'always', label: 'Always' },
                    ...(departments().length
                      ? [{ value: 'department', label: 'For Selected Departments' }]
                      : []),
                    ...(conditionFields().length
                      ? [{ value: 'form', label: 'For Form Values' }]
                      : []),
                  ]}
                  onChange={(value) =>
                    update(step.id, {
                      when:
                        value === 'department'
                          ? { departmentIds: [departments()[0].id] }
                          : value === 'form'
                            ? {
                                fieldId: conditionFields()[0].id,
                                values: [
                                  conditionFields()[0].type === 'boolean'
                                    ? true
                                    : conditionFields()[0].options[0],
                                ],
                              }
                            : undefined,
                    })
                  }
                />
              </label>
              <Show when={step.when?.departmentIds}>
                <MultiSelectLookup
                  label="Departments"
                  value={step.when.departmentIds}
                  options={departments().map((item) => ({
                    value: item.id,
                    label: item.name,
                    href: `/workspace/data/ref-department/records/${item.id}`,
                  }))}
                  onChange={(ids) => {
                    if (ids.length) update(step.id, { when: { departmentIds: ids } });
                  }}
                />
              </Show>
              <Show when={step.when?.fieldId}>
                <ReferenceLookup
                  label="Form Field"
                  value={step.when.fieldId}
                  options={conditionFields().map((field) => ({
                    value: field.id,
                    label: field.label,
                  }))}
                  onChange={(fieldId) => {
                    const field = conditionFields().find((field) => field.id === fieldId);
                    update(step.id, {
                      when: {
                        fieldId,
                        values: [field.type === 'boolean' ? true : field.options[0]],
                      },
                    });
                  }}
                />
                <MultiSelectLookup
                  label="Matching Values"
                  value={step.when.values.map((value) => String(value))}
                  options={
                    conditionFields().find((field) => field.id === step.when.fieldId)?.type ===
                    'boolean'
                      ? [
                          { value: 'true', label: 'Yes' },
                          { value: 'false', label: 'No' },
                        ]
                      : (
                          conditionFields().find((field) => field.id === step.when.fieldId)
                            ?.options || []
                        ).map((value) => ({ value, label: value }))
                  }
                  onChange={(values) => {
                    if (values.length)
                      update(step.id, {
                        when: {
                          fieldId: step.when.fieldId,
                          values:
                            conditionFields().find((field) => field.id === step.when.fieldId)
                              ?.type === 'boolean'
                              ? values.map((value) => value === 'true')
                              : values,
                        },
                      });
                  }}
                />
              </Show>
            </div>
          </details>
        )}
      </For>
    </section>
  );
}
