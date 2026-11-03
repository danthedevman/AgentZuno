import { confirmRemovedFields } from '../services/confirmations.js';
import { For, Show, createEffect } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import Dropdown from './Dropdown.jsx';
export default function DataDefinitionEditor(props) {
  const [fields, setFields] = createStore([]);
  createEffect(() => setFields(reconcile(props.value.fields, { key: 'id' })));
  const update = (changes) => props.onChange({ ...props.value, ...changes });
  const fieldChange = (id, changes) =>
    update({ fields: fields.map((field) => (field.id === id ? { ...field, ...changes } : field)) });
  return (
    <div class="data-definition-editor create-form">
      <Show when={props.protectedFields?.length}>
        <p>
          Built-in fields cannot be removed or have their types changed. You can add custom fields
          and edit labels.
        </p>
      </Show>
      <label>
        Table Name
        <input
          required
          maxlength="80"
          value={props.value.name}
          onInput={(event) => update({ name: event.currentTarget.value })}
        />
      </label>
      <label>
        Description
        <textarea
          maxlength="1000"
          rows="2"
          value={props.value.description}
          onInput={(event) => update({ description: event.currentTarget.value })}
        />
      </label>
      <For each={fields}>
        {(field, index) => (
          <fieldset class="workflow-form-field">
            <legend>Field {index() + 1}</legend>
            <label>
              Label
              <input
                required
                maxlength="80"
                value={field.label}
                onInput={(event) => fieldChange(field.id, { label: event.currentTarget.value })}
              />
            </label>
            <label>
              Type
              <Dropdown
                value={field.type}
                disabled={props.protectedFields?.includes(field.id)}
                ariaLabel={`Type for ${field.label}`}
                onChange={(type) =>
                  update({
                    fields: fields.map((item) => {
                      if (item.id !== field.id) return item;
                      const { referenceTable, ...rest } = item;
                      return {
                        ...rest,
                        type,
                        ...(type === 'reference'
                          ? { referenceTable: referenceTable || 'users' }
                          : {}),
                      };
                    }),
                  })
                }
                options={['text', 'number', 'boolean', 'date', 'email', 'reference'].map(
                  (value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }),
                )}
              />
            </label>
            <Show when={field.type === 'reference'}>
              <label>
                Reference Table
                <Dropdown
                  ariaLabel={`Reference table for ${field.label}`}
                  value={field.referenceTable}
                  disabled={props.protectedFields?.includes(field.id)}
                  options={[
                    { value: 'users', label: 'Users' },
                    ...(props.tables || []).map((table) => ({
                      value: table.id,
                      label: table.name,
                    })),
                  ]}
                  onChange={(referenceTable) => fieldChange(field.id, { referenceTable })}
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
                disabled={props.protectedFields?.includes(field.id)}
                onClick={() => fieldChange(field.id, { required: !field.required })}
              >
                <span />
              </button>
            </div>
            <button
              type="button"
              class="card-link"
              disabled={fields.length === 1 || props.protectedFields?.includes(field.id)}
              onClick={async () => {
                const next = fields.filter((item) => item.id !== field.id);
                if (await confirmRemovedFields(fields, next, true)) update({ fields: next });
              }}
            >
              Remove Field
            </button>
          </fieldset>
        )}
      </For>
      <button
        class="workspace-button secondary small"
        type="button"
        disabled={fields.length >= 20}
        onClick={() =>
          update({
            fields: [
              ...fields,
              {
                id: `field-${crypto.randomUUID().slice(0, 8)}`,
                label: 'New Field',
                type: 'text',
                required: false,
              },
            ],
          })
        }
      >
        Add Field
      </button>
    </div>
  );
}
