import { isMultilineField } from '../../utils/recordFields.js';
import RecordValue from '../records/RecordValue.jsx';
import { For, Match, Switch, createResource } from 'solid-js';
import ReferenceLookup from '../ReferenceLookup.jsx';
import MultiSelectLookup from '../MultiSelectLookup.jsx';
import Dropdown from '../Dropdown.jsx';
import Toggle from '../Toggle.jsx';
import A from '../WorkspaceLink.jsx';
import { api } from '../../services/api.js';
export default function RecordField(props) {
  const [options, { refetch }] = createResource(
    () =>
      props.field.type === 'reference' && !props.field.options ? props.field.referenceTable : false,
    (id) =>
      api(
        `/api/helpdesk/data/tables/${id}/options${props.includeDemo || props.readOnly ? '?includeDemo=1' : ''}`,
      ),
  );
  const availableOptions = () => props.field.options || (options.error ? [] : options.latest || []);
  const isReadOnly = () => props.readOnly || props.field.readOnly;
  const selected = () => availableOptions().find((option) => option.value === props.value);
  const displayValue = () =>
    props.field.type === 'boolean'
      ? props.value
        ? 'Yes'
        : 'No'
      : ['reference', 'select'].includes(props.field.type)
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
        >
          {props.field.multiple ? (
            <For each={availableOptions().filter((option) => props.value?.includes(option.value))}>
              {(option) =>
                option.href ? (
                  <A
                    class="record-value-reference"
                    href={option.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {option.label}
                  </A>
                ) : (
                  <span>{option.label}</span>
                )
              }
            </For>
          ) : undefined}
        </RecordValue>
      </Match>
      <Match when={props.field.type === 'select'}>
        <label>
          {props.field.label}
          <Dropdown
            name={props.field.id}
            ariaLabel={props.field.label}
            value={props.value || ''}
            required={props.field.required}
            options={availableOptions()}
            disabled={props.disabled || isReadOnly()}
            onChange={props.onChange}
          />
        </label>
      </Match>
      <Match when={props.field.type === 'reference' && props.field.multiple}>
        <MultiSelectLookup
          name={props.field.id}
          label={props.field.label}
          referenceTable={props.field.referenceTable}
          value={props.value || []}
          required={props.field.required}
          options={availableOptions()}
          onOpen={() => {
            if (!props.field.options) refetch();
          }}
          disabled={props.disabled || (options.loading && !options.latest) || !!options.error}
          readOnly={isReadOnly()}
          onChange={props.onChange}
        />
      </Match>
      <Match when={props.field.type === 'reference'}>
        <ReferenceLookup
          referenceTable={props.field.referenceTable}
          onOpen={() => {
            if (!props.field.options) refetch();
          }}
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
          disabled={props.disabled || (options.loading && !options.latest) || !!options.error}
          readOnly={isReadOnly()}
        />
      </Match>
      <Match when={props.field.type === 'boolean'}>
        <Toggle
          name={props.field.id}
          label={props.field.label}
          checked={!!props.value}
          disabled={props.disabled || isReadOnly()}
          onChange={props.onChange}
        />
      </Match>
      <Match when={isMultilineField(props.field)}>
        <label>
          {props.field.label}
          <textarea
            name={props.field.id}
            required={props.field.required}
            rows={props.field.rows || 5}
            maxlength={props.field.maxLength || 2000}
            value={props.value ?? ''}
            readOnly={isReadOnly()}
            disabled={props.disabled}
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
            maxlength={props.field.maxLength || 2000}
            step={props.field.type === 'number' ? 'any' : undefined}
            value={props.value ?? ''}
            readOnly={isReadOnly()}
            disabled={props.disabled}
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
