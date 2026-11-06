import ToastMessage from '../ToastMessage.jsx';
import ValidatedForm from '../ValidatedForm.jsx';
import { For, Show, createResource, createSignal, createEffect, on } from 'solid-js';
import Dropdown from '../Dropdown.jsx';
import { api } from '../../services/api.js';
import { useSession } from '../../context/SessionContext.jsx';

export default function AISettings() {
  const { session } = useSession();
  const [catalog] = createResource(() => api('/api/ai-providers'));
  const [settings, { refetch, mutate }] = createResource(
    () => !!session()?.user && !session().user.isDemo,
    () => api('/api/settings/ai'),
  );
  const [provider, setProvider] = createSignal('openai');
  const [model, setModel] = createSignal('');
  const [instructions, setInstructions] = createSignal('');
  const [limit, setLimit] = createSignal(4096);
  const [reasoning, setReasoning] = createSignal('medium');
  const [enabled, setEnabled] = createSignal(true);
  const [isDefault, setIsDefault] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const [message, setMessage] = createSignal('');
  const selected = () => catalog()?.find((item) => item.id === provider());
  const saved = () =>
    !settings.error && settings()?.providers.find((item) => item.provider === provider());
  let keyInput;
  let didSelectInitial = false;
  function selectProvider(value) {
    setProvider(value);
    if (keyInput) keyInput.value = '';
    setError('');
    setMessage('');
  }
  createEffect(
    on(
      () => settings.latest,
      (value) => {
        if (value && !didSelectInitial) {
          didSelectInitial = true;
          if (value.defaultProvider) setProvider(value.defaultProvider);
        }
      },
    ),
  );
  createEffect(
    on([provider, () => settings.latest, () => catalog.latest], () => {
      if (settings.error || catalog.error) return;
      const existing = saved();
      setModel(existing?.model || selected()?.models[0]?.id || '');
      setInstructions(existing?.instructions || '');
      setLimit(existing?.maxOutputTokens || 4096);
      setReasoning(existing?.reasoning || 'medium');
      setEnabled(existing?.enabled ?? true);
      setIsDefault(
        existing
          ? settings.latest?.defaultProvider === provider()
          : !settings.latest?.defaultProvider,
      );
    }),
  );
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api('/api/settings/ai', {
        method: 'POST',
        body: JSON.stringify({
          provider: provider(),
          model: model(),
          instructions: instructions(),
          maxOutputTokens: Number(limit()),
          reasoning: reasoning(),
          enabled: enabled(),
          isDefault: isDefault(),
          apiKey: keyInput.value,
        }),
      });
      keyInput.value = '';
      mutate((current) => ({
        providers: [
          ...(current?.providers || []).filter((item) => item.provider !== result.provider),
          result,
        ],
        defaultProvider: isDefault()
          ? result.provider
          : current?.defaultProvider === result.provider
            ? null
            : current?.defaultProvider || null,
      }));
      await refetch();
      window.dispatchEvent(new Event('ai-settings-changed'));
      setMessage('AI provider and response settings saved.');
    } catch (error) {
      setError(error.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section class="ai-settings">
      <Show
        when={session()?.user && !session().user.isDemo}
        fallback={<p>Sign in with a registered account to configure AI.</p>}
      >
        <p>
          Choose a provider for Chat. Your messages and instructions are sent to that provider when
          you submit a chat.
        </p>
        <Show when={settings.error || catalog.error}>
          <ToastMessage tone="error">Could not load AI settings.</ToastMessage>
        </Show>
        <Show when={settings.loading && !settings.latest}>
          <p role="status">Loading AI providers…</p>
        </Show>
        <Show when={!settings.error && settings.latest?.providers.length}>
          <div class="helpdesk-list" aria-label="Saved AI providers">
            <For each={settings.latest.providers}>
              {(item) => (
                <div class="helpdesk-list-row">
                  <strong>
                    {catalog()?.find((provider) => provider.id === item.provider)?.name ||
                      item.provider}
                  </strong>
                  <span>
                    {item.model} · {item.enabled ? 'Enabled' : 'Disabled'}
                    {settings.latest.defaultProvider === item.provider ? ' · Default' : ''} ·{' '}
                    {item.hasApiKey ? 'API key saved' : 'API key missing'}
                  </span>
                  <button
                    class="workspace-button secondary small"
                    type="button"
                    disabled={saving()}
                    onClick={() => selectProvider(item.provider)}
                  >
                    Edit
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show when={!settings.error && !catalog.error && settings.latest && catalog()}>
          <ValidatedForm class="create-form" onSubmit={save}>
            <label>
              Provider
              <Dropdown
                ariaLabel="AI provider"
                value={provider()}
                onChange={selectProvider}
                disabled={saving()}
                options={(catalog() || []).map((item) => ({ value: item.id, label: item.name }))}
              />
            </label>
            <label>
              Model
              <Dropdown
                ariaLabel="AI model"
                value={model()}
                onChange={setModel}
                disabled={saving()}
                options={(selected()?.models || []).map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
              />
            </label>
            <label>
              API key
              <input
                ref={keyInput}
                name="apiKey"
                disabled={saving()}
                type="password"
                autocomplete="new-password"
                required={!saved()?.hasApiKey}
                maxlength="10000"
                placeholder={
                  saved()?.hasApiKey ? 'Leave blank to keep the saved key' : 'Provider API key'
                }
              />
            </label>
            <label>
              Instructions
              <textarea
                rows="5"
                disabled={saving()}
                maxlength="12000"
                placeholder="Be concise, explain your reasoning clearly, and use a helpful tone."
                value={instructions()}
                onInput={(event) => setInstructions(event.currentTarget.value)}
              />
            </label>
            <label>
              Maximum output tokens
              <input
                type="number"
                disabled={saving()}
                min="256"
                max="16384"
                step="1"
                required
                value={limit()}
                onInput={(event) => setLimit(event.currentTarget.value)}
              />
            </label>
            <Show when={selected()?.supportsReasoning}>
              <label>
                Reasoning effort
                <Dropdown
                  ariaLabel="Reasoning effort"
                  value={reasoning()}
                  onChange={setReasoning}
                  disabled={saving()}
                  options={['low', 'medium', 'high'].map((value) => ({
                    value,
                    label: value[0].toUpperCase() + value.slice(1),
                  }))}
                />
              </label>
            </Show>
            <div class="preference-row">
              <span>Enable provider</span>
              <button
                type="button"
                class="toggle-switch"
                role="switch"
                disabled={saving()}
                aria-label="Enable provider"
                aria-checked={enabled()}
                onClick={() => setEnabled(!enabled())}
              >
                <span />
              </button>
            </div>
            <div class="preference-row">
              <span>Use as default</span>
              <button
                type="button"
                class="toggle-switch"
                role="switch"
                disabled={saving()}
                aria-label="Use as default"
                aria-checked={isDefault()}
                onClick={() => setIsDefault(!isDefault())}
              >
                <span />
              </button>
            </div>
            <Show when={error()}>
              <ToastMessage tone="error">{error()}</ToastMessage>
            </Show>
            <Show when={message()}>
              <ToastMessage tone="success" message={message()} />
            </Show>
            <button class="workspace-button" disabled={saving()}>
              {saving() ? 'Saving…' : 'Save AI settings'}
            </button>
          </ValidatedForm>
        </Show>
      </Show>
    </section>
  );
}
