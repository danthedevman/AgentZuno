import Skeleton from './Skeleton.jsx';
import { Show, createResource } from 'solid-js';
import { api } from '../services/api.js';
import Dropdown from './Dropdown.jsx';
import MultiSelectLookup from './MultiSelectLookup.jsx';
import ToastMessage from './ToastMessage.jsx';
export default function WorkflowPermissionsEditor(props) {
  const [users] = createResource(() => api('/api/helpdesk/reference-records'));
  const [queues] = createResource(() => api('/api/helpdesk/queues'));
  const value = () => props.value || { audience: 'workspace', userIds: [], queueNames: [] };
  return (
    <div class="create-form">
      <Show when={users.loading || queues.loading}>
        <Skeleton label="Loading visibility settings" lines={3} />
      </Show>
      <div class="tab-content-reveal" hidden={users.loading || queues.loading}>
        <Show when={users.error || queues.error}>
          <ToastMessage tone="error">{users.error?.message || queues.error?.message}</ToastMessage>
        </Show>
        <label>
          Access
          <Dropdown
            ariaLabel="Workflow Access"
            value={value().audience}
            disabled={props.disabled}
            options={[
              { value: 'workspace', label: 'All Workspace Users' },
              { value: 'restricted', label: 'Selected Users and Queues' },
            ]}
            onChange={(audience) => props.onChange({ audience, userIds: [], queueNames: [] })}
          />
        </label>
        <Show when={value().audience === 'restricted'}>
          <MultiSelectLookup
            label="Users"
            name="workflowUsers"
            options={
              !users.error
                ? (users()?.users || []).map((user) => ({
                    value: user.id,
                    label: user.name,
                    href: `/workspace/users/${user.id}`,
                  }))
                : []
            }
            value={value().userIds}
            onChange={(userIds) => props.onChange({ ...value(), userIds })}
            disabled={props.disabled || users.loading || !!users.error}
          />
          <MultiSelectLookup
            label="Assignment Groups"
            name="workflowQueues"
            options={
              !queues.error
                ? (queues() || []).map((queue) => ({
                    value: queue.name,
                    label: queue.name,
                    href: `/workspace/users/groups/${queue.groupId || queue.id}`,
                  }))
                : []
            }
            value={value().queueNames}
            onChange={(queueNames) => props.onChange({ ...value(), queueNames })}
            disabled={props.disabled || queues.loading || !!queues.error}
          />
        </Show>
      </div>
    </div>
  );
}
