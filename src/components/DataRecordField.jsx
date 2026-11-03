import { Match, Switch, createResource } from 'solid-js';
import ReferenceLookup from './ReferenceLookup.jsx';
import { api } from '../services/api.js';
export default function DataRecordField(props) {
  const [options] = createResource(
    () => (props.field.type === 'reference' ? props.field.referenceTable : false),
    (id) => api(`/api/helpdesk/data/tables/${id}/options`),
  );
  return (
    <Switch>
      <Match when={props.field.type === 'reference'}>
        <ReferenceLookup
          name={props.field.id}
          label={props.field.label}
          required={props.field.required}
          value={props.value || ''}
          onChange={props.onChange}
          options={options() || []}
          disabled={options.loading || !!options.error}
          readOnly={props.readOnly}
        />
      </Match>
      <Match when={props.field.type === 'boolean'}>
        <div class="preference-row">
          <span>{props.field.label}</span>
          <button
            class="toggle-switch"
            type="button"
            role="switch"
            aria-label={props.field.label}
            aria-checked={!!props.value}
            disabled={props.readOnly}
            onClick={() => props.onChange(!props.value)}
          >
            <span />
          </button>
        </div>
      </Match>
      <Match when={true}>
        <label>
          {props.field.label}
          <input
            name={props.field.id}
            required={props.field.required}
            type={
              ['number', 'date', 'email'].includes(props.field.type) ? props.field.type : 'text'
            }
            maxlength="2000"
            step={props.field.type === 'number' ? 'any' : undefined}
            value={props.value ?? ''}
            readOnly={props.readOnly}
            onInput={(event) =>
              props.onChange(
                props.field.type === 'number' && event.currentTarget.value !== ''
                  ? Number(event.currentTarget.value)
                  : event.currentTarget.value,
              )
            }
          />
        </label>
      </Match>
    </Switch>
  );
}
