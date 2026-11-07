import Icon from '../Icon.jsx';
import { Show, createEffect, createSignal } from 'solid-js';
import ValidatedForm from '../ValidatedForm.jsx';
import { api } from '../../services/api.js';
import { useToasts } from '../../context/ToastContext.jsx';
export default function ConnectorApplicationForm(props) {
  const [clientId, setClientId] = createSignal('');
  const [clientSecret, setClientSecret] = createSignal('');
  const [signingSecret, setSigningSecret] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const { notify } = useToasts();
  createEffect(() => {
    setClientId(props.channel.application?.clientId || '');
    setClientSecret('');
    setSigningSecret('');
  });
  const keepSecret = () => clientId() === props.channel.application?.clientId;
  return (
    <ValidatedForm
      class="create-form connector-application-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        try {
          await api(`/api/helpdesk/channels/${props.channel.id}/application`, {
            method: 'PUT',
            body: JSON.stringify({
              clientId: clientId(),
              clientSecret: clientSecret(),
              signingSecret: signingSecret(),
              version: props.channel.application?.version || 0,
            }),
          });
          setClientSecret('');
          setSigningSecret('');
          await props.onSaved();
          notify({
            tone: 'success',
            message:
              props.channel.id === 'teams'
                ? 'Connection details saved. Configure the Teams bot below.'
                : 'Connection details saved. Continue with authorization.',
          });
        } catch (error) {
          notify({ tone: 'error', message: error.message });
        } finally {
          setSaving(false);
        }
      }}
    >
      <label>
        Client ID
        <input
          required
          maxlength="512"
          autocomplete="off"
          value={clientId()}
          onInput={(event) => setClientId(event.currentTarget.value.trim())}
        />
      </label>
      <label>
        Client Secret
        <input
          type="password"
          required={!keepSecret() || !props.channel.application?.hasClientSecret}
          maxlength="4000"
          autocomplete="new-password"
          placeholder={
            keepSecret() && props.channel.application?.hasClientSecret
              ? 'Saved — leave blank to keep'
              : 'Enter client secret'
          }
          value={clientSecret()}
          onInput={(event) => setClientSecret(event.currentTarget.value)}
        />
      </label>
      <Show when={props.channel.id === 'slack'}>
        <label>
          Signing Secret
          <input
            type="password"
            required={!keepSecret() || !props.channel.application?.hasSigningSecret}
            maxlength="512"
            autocomplete="new-password"
            placeholder={
              keepSecret() && props.channel.application?.hasSigningSecret
                ? 'Saved — leave blank to keep'
                : 'Enter signing secret'
            }
            value={signingSecret()}
            onInput={(event) => setSigningSecret(event.currentTarget.value)}
          />
        </label>
      </Show>
      <Show when={props.channel.connected}>
        <p>Saving application details requires you to confirm the connector settings again.</p>
      </Show>
      <button class="workspace-button small" disabled={saving()}>
        <Icon name="save" />

        {saving() ? 'Saving…' : 'Save Connection Details'}
      </button>
    </ValidatedForm>
  );
}
