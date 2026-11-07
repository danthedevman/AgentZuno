import Icon from '../Icon.jsx';
import Toggle from '../Toggle.jsx';
import { For, Show, createEffect, createSignal } from 'solid-js';
import ValidatedForm from '../ValidatedForm.jsx';
import { api } from '../../services/api.js';
import { useToasts } from '../../context/ToastContext.jsx';

export default function ConnectorActionsForm(props) {
  const [actions, setActions] = createSignal({});
  const [saving, setSaving] = createSignal(false);
  const { notify } = useToasts();
  createEffect(() =>
    setActions(
      Object.fromEntries(
        (props.channel.actions?.items || []).map((item) => [item.id, item.enabled]),
      ),
    ),
  );
  return (
    <Show when={props.channel.actions?.items?.length}>
      <ValidatedForm
        class="create-form connector-actions-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          try {
            await api(`/api/helpdesk/channels/${props.channel.id}/actions`, {
              method: 'PUT',
              body: JSON.stringify({ version: props.channel.actions.version, actions: actions() }),
            });
            await props.onSaved();
            notify({ tone: 'success', message: 'Connector actions saved.' });
          } catch (error) {
            notify({ tone: 'error', message: error.message });
          } finally {
            setSaving(false);
          }
        }}
      >
        <h2>Allowed Actions</h2>
        <For each={props.channel.actions.items}>
          {(item) => (
            <div>
              <Toggle
                label={item.label}

                checked={actions()[item.id]}
                disabled={saving()}
                onChange={(enabled) => setActions({ ...actions(), [item.id]: enabled })}
              />
              <p>{item.description}</p>
            </div>
          )}
        </For>
        <button class="workspace-button small" disabled={saving()}>
          <Icon name="save" />

          {saving() ? 'Saving…' : 'Save Actions'}
        </button>
      </ValidatedForm>
    </Show>
  );
}
