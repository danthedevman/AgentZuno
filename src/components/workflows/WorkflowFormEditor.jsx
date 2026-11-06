import { api } from '../../services/api.js';
import { confirmRemovedFields } from '../../services/confirmations.js';
import { createStore, reconcile } from 'solid-js/store';
import { For, Show, createEffect, createResource, createSignal } from 'solid-js';
import Dropdown from '../Dropdown.jsx';
import RequestForm from '../requests/RequestForm.jsx';
export default function WorkflowFormEditor(props) {
  const [preview, setPreview] = createSignal(false);
  const update = (changes) => props.onChange({ ...props.form, ...changes });
  const [stableFields, setStableFields] = createStore([]);
  createEffect(() => setStableFields(reconcile(props.form?.fields || [], { key: 'id' })));
  const fields = () => stableFields;
  const [tables] = createResource(
    () => fields().some((field) => field.type === 'reference'),
    () => api('/api/helpdesk/data/tables'),
  );
  const changeField = (id, changes) =>
    update({
      fields: fields().map((field) => (field.id === id ? { ...field, ...changes } : field)),
    });
  function addField() {
    const id = `field-${crypto.randomUUID().slice(0, 8)}`;
    props.onChange({
      title: props.form?.title || props.name || 'Request',
      fields: [...fields(), { id, label: 'New Field', type: 'text', required: false }],
    });
  }
  return (
    <div class="workflow-form-editor">
      <div class="workflow-form-heading">
        <Show when={props.form}>
          <button class="workspace-button secondary small" onClick={() => setPreview(!preview())}>
            {preview() ? 'Edit Fields' : 'Preview Form'}
          </button>
        </Show>
      </div>
      <Show
        when={props.form}
        fallback={
          <p>Ask the Admin agent to create an order item with questions, or add fields below.</p>
        }
      >
        <Show
          when={preview()}
          fallback={
            <div class="create-form">
              <label>
                Form Title
                <input
                  maxlength="80"
                  value={props.form.title}
                  disabled={props.disabled}
                  onInput={(event) => update({ title: event.currentTarget.value })}
                />
              </label>
              <For each={fields()}>
                {(field, index) => (
                  <details class="workflow-field-accordion">
                    <summary>{field.label || `Field ${index() + 1}`}</summary>
                    <fieldset class="workflow-form-field" disabled={props.disabled}>
                      <legend>Field {index() + 1}</legend>
                      <label>
                        Label
                        <input
                          maxlength="160"
                          value={field.label}
                          onInput={(event) =>
                            changeField(field.id, { label: event.currentTarget.value })
                          }
                        />
                      </label>
                      <label>
                        Type
                        <Dropdown
                          ariaLabel={`Type for ${field.label}`}
                          value={field.type}
                          disabled={props.disabled}
                          options={[
                            { value: 'text', label: 'Short Text' },
                            { value: 'textarea', label: 'Long Text' },
                            { value: 'select', label: 'Choice' },
                            { value: 'boolean', label: 'Yes / No' },
                            { value: 'reference', label: 'Reference' },
                          ]}
                          onChange={(type) =>
                            update({
                              fields: fields().map((item) => {
                                if (item.id !== field.id) return item;
                                const { options, referenceTable, ...rest } = item;
                                return {
                                  ...rest,
                                  type,
                                  ...(type === 'reference'
                                    ? { referenceTable: referenceTable || 'users' }
                                    : {}),
                                  ...(type === 'select'
                                    ? { options: options || ['Option 1', 'Option 2'] }
                                    : {}),
                                };
                              }),
                            })
                          }
                        />
                      </label>
                      <Show when={field.type === 'reference'}>
                        <label>
                          Reference Table
                          <Dropdown
                            ariaLabel={`Reference table for ${field.label}`}
                            value={field.referenceTable}
                            disabled={props.disabled || tables.loading}
                            options={[
                              { value: 'users', label: 'Users' },
                              ...(tables() || [])
                                .filter((table) => table.id !== 'ref-user')
                                .map((table) => ({ value: table.id, label: table.name })),
                            ]}
                            onChange={(referenceTable) => changeField(field.id, { referenceTable })}
                          />
                        </label>
                        <p>
                          Publishing this field lets permitted users search record names. Full
                          record access follows their existing permissions.
                        </p>
                      </Show>
                      <Show when={field.type === 'select'}>
                        <label>
                          Choices (one per line)
                          <textarea
                            rows="3"
                            value={field.options.join('\n')}
                            onInput={(event) =>
                              changeField(field.id, {
                                options: event.currentTarget.value.split('\n'),
                              })
                            }
                          />
                        </label>
                      </Show>
                      <div class="preference-row">
                        <span>Required</span>
                        <button
                          type="button"
                          class="toggle-switch"
                          role="switch"
                          aria-label={`Required: ${field.label}`}
                          aria-checked={field.required}
                          onClick={() => changeField(field.id, { required: !field.required })}
                        >
                          <span />
                        </button>
                      </div>
                      <button
                        class="card-link"
                        type="button"
                        onClick={async () => {
                          if (
                            !(await confirmRemovedFields(
                              fields(),
                              fields().filter((item) => item.id !== field.id),
                              true,
                            ))
                          )
                            return;
                          props.onChange(
                            fields().length === 1
                              ? null
                              : {
                                  ...props.form,
                                  fields: fields().filter((item) => item.id !== field.id),
                                },
                          );
                        }}
                      >
                        Remove Field
                      </button>
                    </fieldset>
                  </details>
                )}
              </For>
            </div>
          }
        >
          <RequestForm form={props.form} identity={JSON.stringify(props.form)} preview />
        </Show>
      </Show>
      <Show when={!preview() || !props.form}>
        <button
          type="button"
          class="workspace-button secondary small"
          disabled={props.disabled || fields().length >= 20}
          onClick={addField}
        >
          Add Field
        </button>
      </Show>
    </div>
  );
}
