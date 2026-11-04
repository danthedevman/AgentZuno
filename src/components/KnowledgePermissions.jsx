import Skeleton from './Skeleton.jsx';
import { Show, createResource, createSignal } from 'solid-js';
import { api } from '../services/api.js';
import Dropdown from './Dropdown.jsx';
import MultiSelectLookup from './MultiSelectLookup.jsx';
import ToastMessage from './ToastMessage.jsx';
export default function KnowledgePermissions(props) {
  const [mode, setMode] = createSignal('inherit');
  const [userIds, setUserIds] = createSignal([]);
  const [version, setVersion] = createSignal(0);
  const [saving, setSaving] = createSignal(false);
  const [message, setMessage] = createSignal('');
  const endpoint = () => `/api/helpdesk/knowledge-permissions/${props.kind}/${props.id}`;
  const [policy] = createResource(
    () => props.id,
    async () => {
      const result = await api(endpoint());
      setMode(result.mode);
      setUserIds(result.userIds);
      setVersion(result.version);
      return result;
    },
  );
  const [members] = createResource(() => api('/api/helpdesk/members'));
  return (
    <section class="knowledge-permissions">
      <Show when={policy.loading || members.loading}>
        <Skeleton label="Loading permissions" lines={3} />
      </Show>
      <div class="tab-content-reveal" hidden={policy.loading || members.loading}>
        <Show when={policy.error || members.error}>
          <ToastMessage tone="error">
            {policy.error?.message || members.error?.message}
          </ToastMessage>
        </Show>
        <Dropdown
          ariaLabel="Knowledge access"
          value={mode()}
          options={[
            { value: 'inherit', label: props.kind === 'base' ? 'Admins Only' : 'Inherit' },
            { value: 'workspace', label: 'Workspace Members' },
            { value: 'restricted', label: 'Selected Users' },
          ]}
          onChange={setMode}
        />
        <Show when={mode() === 'restricted'}>
          <MultiSelectLookup
            label="Users"
            value={userIds()}
            options={((!members.error && members()) || [])
              .filter((item) => item.active)
              .map((item) => ({
                value: item.userId || item.id,
                label: item.name || item.email,
                href: `/workspace/users/${item.userId || item.id}`,
              }))}
            onChange={setUserIds}
          />
        </Show>
        <p class="field-help">
          Base, topic, and article restrictions apply together. Admins retain management access.
        </p>
        <button
          type="button"
          class="workspace-button secondary small"
          disabled={saving() || policy.loading || !!policy.error}
          onClick={async () => {
            setSaving(true);
            setMessage('');
            try {
              const result = await api(endpoint(), {
                method: 'PUT',
                body: JSON.stringify({
                  mode: mode(),
                  userIds: userIds(),
                  roles: [],
                  version: version(),
                }),
              });
              setVersion(result.version);
              setMessage('Permissions saved.');
            } catch (error) {
              setMessage(error.message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {' '}
          {saving() ? 'Saving…' : 'Save Permissions'}
        </button>
        <Show when={message()}>
          <ToastMessage>{message()}</ToastMessage>
        </Show>
      </div>
    </section>
  );
}
