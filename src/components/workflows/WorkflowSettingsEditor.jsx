import { assignmentGroupOptions } from '../../utils/assignmentGroups.js';
import { createResource, For, Show } from 'solid-js';
import { api } from '../../services/api.js';
import ReferenceLookup from '../ReferenceLookup.jsx';
import Toggle from '../Toggle.jsx';
import A from '../WorkspaceLink.jsx';
import Dropdown from '../Dropdown.jsx';
export default function WorkflowSettingsEditor(props) {
  const [departments] = createResource(() =>
    api(
      `/api/helpdesk/data/tables/ref-department/options${props.includeDemo ? '?includeDemo=1' : ''}`,
    ),
  );
  const [queues] = createResource(() =>
    api(`/api/helpdesk/queues?reference=1${props.includeDemo ? '&includeDemo=1' : ''}`),
  );
  const [applications, { refetch: refreshApplications }] = createResource(() =>
    api('/api/helpdesk/data/tables/ref-application/options'),
  );
  const settings = () => props.value?.settings || {};
  const update = (changes) =>
    props.onChange({ ...props.value, settings: { ...settings(), ...changes } });
  const route = () => props.value.steps.find((step) => ['route', 'handoff'].includes(step.action));
  return (
    <section class="workflow-form-editor create-form" aria-label="Workflow Settings">
      <fieldset class="form-settings-section">
        <legend>Access Tracking</legend>
        <Toggle
          label="Track application access"
          checked={!!settings().accessTracking}
          disabled={props.disabled}
          onChange={(enabled) =>
            update({
              accessTracking: enabled ? { applicationId: '', accessFieldId: '' } : undefined,
            })
          }
        />
        <Show when={settings().accessTracking}>
          <ReferenceLookup
            label="Application"
            referenceTable="ref-application"
            value={settings().accessTracking?.applicationId || ''}
            options={applications.error ? [] : applications() || []}
            disabled={props.disabled || applications.loading}
            onOpen={refreshApplications}
            onChange={(value) =>
              update({ accessTracking: { ...settings().accessTracking, applicationId: value } })
            }
          />
          <label>
            Access Level Field
            <Dropdown
              ariaLabel="Access level field"
              value={settings().accessTracking?.accessFieldId || ''}
              disabled={props.disabled}
              options={(props.value.form?.fields || [])
                .filter((field) => field.required && ['text', 'select'].includes(field.type))
                .map((field) => ({ value: field.id, label: field.label }))}
              onChange={(value) =>
                update({ accessTracking: { ...settings().accessTracking, accessFieldId: value } })
              }
            />
          </label>
          <p class="field-help">
            Track submitted access requests and prevent duplicate pending or active access at the
            same level. An authorized fulfiller must confirm access after provisioning; approvals
            never activate it.
          </p>
        </Show>
      </fieldset>
      <ReferenceLookup
        label="Department"
        placeholder="Any Department"
        value={props.value.trigger.departmentId || ''}
        options={departments() || []}
        disabled={props.disabled || departments.loading}
        onChange={(id) => {
          const { departmentId, ...trigger } = props.value.trigger;
          props.onChange({
            ...props.value,
            trigger: { ...trigger, department: 'general', ...(id ? { departmentId: id } : {}) },
          });
        }}
      />
      <label>
        Description
        <textarea
          maxlength="500"
          rows="3"
          value={settings().description || ''}
          disabled={props.disabled}
          onInput={(event) => update({ description: event.currentTarget.value })}
        />
      </label>
      <ReferenceLookup
        label="Default Assignment Group"
        value={route()?.params.queueName || ''}
        disabled={props.disabled || queues.loading || !route()}
        options={assignmentGroupOptions(queues() || [])}
        onChange={(queueName) =>
          props.onChange({
            ...props.value,
            steps: props.value.steps.map((step) =>
              step.id === route()?.id ? { ...step, params: { ...step.params, queueName } } : step,
            ),
          })
        }
      />
      <label>
        Post-Submission Message
        <textarea
          maxlength="500"
          rows="3"
          value={settings().submissionMessage || ''}
          disabled={props.disabled}
          onInput={(event) => update({ submissionMessage: event.currentTarget.value })}
        />
      </label>
      <For
        each={[
          {
            key: 'timeoutSeconds',
            label: 'Execution Timeout (Seconds)',
            min: 5,
            max: 60,
            value: 60,
          },
          { key: 'maxConcurrentRuns', label: 'Maximum Concurrent Runs', min: 1, max: 10, value: 2 },
        ]}
      >
        {(field) => (
          <label>
            {field.label}
            <input
              type="number"
              min={field.min}
              max={field.max}
              step="1"
              value={settings()[field.key] ?? field.value}
              disabled={props.disabled}
              onChange={(event) => update({ [field.key]: Number(event.currentTarget.value) })}
            />
          </label>
        )}
      </For>
      <p class="field-help">
        Changes apply after publication. Worker capacity can further limit concurrency.
      </p>
    </section>
  );
}
