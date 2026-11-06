import RecordValue from '../records/RecordValue.jsx';
import { Match, Switch, createResource } from 'solid-js';
import ReferenceLookup from '../ReferenceLookup.jsx';
import { api } from '../../services/api.js';
export default function DataRecordField(props) {
  const [options, { refetch }] = createResource(
    () => (props.field.type === 'reference' ? props.field.referenceTable : false),
    (id) =>
      api(
        `/api/helpdesk/data/tables/${id}/options${props.includeDemo || props.readOnly ? '?includeDemo=1' : ''}`,
      ),
  );
  const availableOptions = () => (options.error ? [] : options.latest || []);
  const selected = () => availableOptions().find((option) => option.value === props.value);
  const displayValue = () =>
    props.field.type === 'boolean'
      ? props.value
        ? 'Yes'
        : 'No'
      : props.field.type === 'reference'
        ? options.loading && !options.latest
          ? 'Loading…'
          : selected()?.label || '—'
        : props.value === 0
          ? '0'
          : props.value;
  return (
    <Switch>
      <Match when={props.detailsOnly}>
        <RecordValue
          label={props.field.label}
          value={displayValue()}
          href={
            props.field.type === 'reference' && selected()
              ? selected().href ||
                `/workspace/data/${props.field.referenceTable}/records/${encodeURIComponent(selected().value)}`
              : undefined
          }
        />
      </Match>
      <Match when={props.field.type === 'reference'}>
        <ReferenceLookup
          referenceTable={props.field.referenceTable}
          onOpen={() => refetch()}
          name={props.field.id}
          label={props.field.label}
          required={props.field.required}
          value={props.value || ''}
          onChange={props.onChange}
          options={availableOptions().map((option) => ({
            ...option,
            href:
              option.href ||
              `/workspace/data/${props.field.referenceTable}/records/${encodeURIComponent(option.value)}`,
          }))}
          disabled={(options.loading && !options.latest) || !!options.error}
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
      <Match
        when={[
          'description',
          'details',
          'notes',
          'routingInstructions',
          'routing-instructions',
        ].includes(props.field.id)}
      >
        <label>
          {props.field.label}
          <textarea
            name={props.field.id}
            required={props.field.required}
            rows="5"
            maxlength="2000"
            value={props.value ?? ''}
            readOnly={props.readOnly}
            onInput={(event) => props.onChange(event.currentTarget.value)}
          />
        </label>
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
