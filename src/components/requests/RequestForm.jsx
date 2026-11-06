import WorkflowReferenceField from '../workflows/WorkflowReferenceField.jsx';
import { createStore, reconcile } from 'solid-js/store';
import { For, Show, createEffect, createSignal } from 'solid-js';
import Dropdown from '../Dropdown.jsx';
import ValidatedForm from '../ValidatedForm.jsx';
import ToastMessage from '../ToastMessage.jsx';

export default function RequestForm(props) {
  const [fields, setFields] = createStore([]);
  createEffect(() => setFields(reconcile(props.form.fields, { key: 'id' })));
  const [answers, setAnswers] = createSignal({});
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  createEffect(() => {
    props.identity;
    setAnswers({});
    setError('');
  });
  const change = (id, value) => setAnswers((previous) => ({ ...previous, [id]: value }));
  async function submit(event) {
    event.preventDefault();
    if (props.preview || saving()) return;
    setSaving(true);
    setError('');
    try {
      await props.onSubmit(
        Object.fromEntries(
          props.form.fields.map((field) => [
            field.id,
            answers()[field.id] ?? (field.type === 'boolean' ? false : ''),
          ]),
        ),
      );
    } catch (error) {
      setError(error.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section class="request-form-card" aria-label={props.form.title}>
      <h3>{props.form.title}</h3>
      <Show when={error()}>
        <ToastMessage tone="error" message={error()} />
      </Show>
      <ValidatedForm class="create-form" onSubmit={submit}>
        <For each={fields}>
          {(field) => (
            <Show
              when={field.type !== 'boolean'}
              fallback={
                <div class="preference-row">
                  <span>
                    {field.label}
                    <Show when={!field.required}>
                      <small>Optional</small>
                    </Show>
                  </span>
                  <button
                    class="toggle-switch"
                    type="button"
                    role="switch"
                    aria-label={field.label}
                    aria-checked={!!answers()[field.id]}
                    disabled={saving()}
                    onClick={() => change(field.id, !answers()[field.id])}
                  >
                    <span />
                  </button>
                </div>
              }
            >
              <Show
                when={field.type === 'reference'}
                fallback={
                  <label>
                    {field.label}
                    <Show when={!field.required}>
                      <small>Optional</small>
                    </Show>
                    <Show
                      when={field.type === 'select'}
                      fallback={
                        <Show
                          when={field.type === 'textarea'}
                          fallback={
                            <input
                              name={field.id}
                              required={field.required}
                              maxlength="500"
                              disabled={saving()}
                              value={answers()[field.id] || ''}
                              onInput={(event) => change(field.id, event.currentTarget.value)}
                            />
                          }
                        >
                          <textarea
                            name={field.id}
                            required={field.required}
                            maxlength="2000"
                            rows="3"
                            disabled={saving()}
                            value={answers()[field.id] || ''}
                            onInput={(event) => change(field.id, event.currentTarget.value)}
                          />
                        </Show>
                      }
                    >
                      <Dropdown
                        name={field.id}
                        ariaLabel={field.label}
                        required={field.required}
                        placeholder="Choose an option"
                        value={answers()[field.id] || ''}
                        disabled={saving()}
                        onChange={(value) => change(field.id, value)}
                        options={field.options.map((value) => ({ value, label: value }))}
                      />
                    </Show>
                  </label>
                }
              >
                <WorkflowReferenceField
                  field={field}
                  workflowId={props.form.workflowId}
                  preview={props.preview}
                  value={answers()[field.id] || ''}
                  onChange={(value) => change(field.id, value)}
                  disabled={saving()}
                />
              </Show>
            </Show>
          )}
        </For>
        <Show
          when={!props.preview}
          fallback={<span class="request-form-preview-label">Form Preview</span>}
        >
          <button class="workspace-button" disabled={saving() || props.disabled}>
            {saving() ? 'Processing…' : props.submitLabel || 'Submit Request'}
          </button>
        </Show>
      </ValidatedForm>
    </section>
  );
}
