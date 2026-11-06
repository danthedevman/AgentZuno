import Skeleton from '../Skeleton.jsx';
import { Show, createResource, createSignal } from 'solid-js';
import { api } from '../../services/api.js';
import Dropdown from '../Dropdown.jsx';
import MultiSelectLookup from '../MultiSelectLookup.jsx';
import ToastMessage from '../ToastMessage.jsx';
export default function KnowledgePermissions(props) {
  const [mode, setMode] = createSignal('inherit');
  const [userIds, setUserIds] = createSignal([]);
  const [version, setVersion] = createSignal(0);
  const [roles, setRoles] = createSignal([]);
  const [saving, setSaving] = createSignal(false);
  const [message, setMessage] = createSignal('');
  const [tone, setTone] = createSignal('info');
  const endpoint = () => `/api/helpdesk/knowledge-permissions/${props.kind}/${props.id}`;
  const [policy] = createResource(
    () => props.id || false,
    async () => {
      const result = await api(endpoint());
      setMode(result.mode);
      setUserIds(result.userIds);
      setVersion(result.version);
      setRoles(result.roles || []);
      return result;
    },
  );
  const [members] = createResource(() => api('/api/helpdesk/members'));
  async function savePermissions(id = props.id) {
    if (policy.loading || members.loading || policy.error || members.error)
      throw new Error('Permissions could not be loaded. Reload and try again.');
    const result = await api(`/api/helpdesk/knowledge-permissions/${props.kind}/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        mode: mode(),
        userIds: userIds(),
        roles: roles(),
        version: version(),
      }),
    });
    setVersion(result.version);
    return result;
  }
  props.controller?.({
    save: savePermissions,
    get ready() {
      return !policy.loading && !members.loading && !policy.error && !members.error;
    },
  });
  return (
    <section class="knowledge-permissions">
      <Show when={policy.loading || members.loading}>
        <Skeleton label="Loading permissions" lines={3} />
      </Show>
      <Show when={props.readOnly && !policy.loading && !members.loading}>
        <dl class="record-value">
          <dt>Access</dt>
          <dd>
            {mode() === 'inherit'
              ? 'Inherit from Knowledge Base'
              : mode() === 'workspace'
                ? 'Workspace Members'
                : 'Selected Users'}
          </dd>
        </dl>
        <Show when={mode() === 'restricted'}>
          <p>
            {(members.error ? [] : members() || [])
              .filter((member) => userIds().includes(member.userId || member.id))
              .map((member) => member.name || member.email)
              .join(', ') || 'No users selected'}
          </p>
        </Show>
      </Show>
      <div
        class="create-form tab-content-reveal"
        hidden={policy.loading || members.loading || props.readOnly}
      >
        <Show when={policy.error || members.error}>
          <ToastMessage tone="error">
            {policy.error?.message || members.error?.message}
          </ToastMessage>
        </Show>
        <Dropdown
          ariaLabel="Knowledge access"
          disabled={props.disabled || saving()}
          value={mode()}
          options={[
            { value: 'inherit', label: props.kind === 'base' ? 'Admins Only' : 'Inherit' },
            { value: 'workspace', label: 'Workspace Members' },
            { value: 'restricted', label: 'Selected Users' },
          ]}
          onChange={(value) => {
            setMode(value);
            props.onChange?.();
          }}
        />
        <Show when={mode() === 'restricted'}>
          <MultiSelectLookup
            label="Users"
            disabled={props.disabled || saving()}
            placeholder="Search users…"
            value={userIds()}
            options={((!members.error && members()) || [])
              .filter((item) => item.active)
              .map((item) => ({
                value: item.userId || item.id,
                label: item.name || item.email,
                href: `/workspace/users/${item.userId || item.id}`,
              }))}
            onChange={(value) => {
              setUserIds(value);
              props.onChange?.();
            }}
          />
        </Show>
        <p class="field-help">
          Base, topic, and article restrictions apply together. Admins retain management access.
        </p>
        <Show when={!props.embedded}>
          <button
            type="button"
            class="workspace-button secondary small"
            disabled={saving() || policy.loading || !!policy.error}
            onClick={async () => {
              setSaving(true);
              setMessage('');
              try {
                await savePermissions();
                setTone('info');
                setMessage('Permissions saved.');
              } catch (error) {
                setTone('error');
                setMessage(error.message);
              } finally {
                setSaving(false);
              }
            }}
          >
            {' '}
            {saving() ? 'Saving…' : 'Save Permissions'}
          </button>
        </Show>
        <Show when={message()}>
          <ToastMessage tone={tone()}>{message()}</ToastMessage>
        </Show>
      </div>
    </section>
  );
}
