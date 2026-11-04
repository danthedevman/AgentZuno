import { createResource, createSignal, createEffect, onCleanup, Show } from 'solid-js';
import ReferenceLookup from './ReferenceLookup.jsx';
import { api } from '../services/api.js';
import ToastMessage from './ToastMessage.jsx';
export default function WorkflowReferenceField(props) {
  const [search, setSearch] = createSignal(''),
    [query, setQuery] = createSignal(''),
    [cached, setCached] = createSignal([]);
  createEffect(() => {
    const value = search();
    const timer = setTimeout(() => setQuery(value), 180);
    onCleanup(() => clearTimeout(timer));
  });
  const identity = () =>
    `${props.workflowId || 'preview'}:${props.field.referenceTable}:${props.field.id}`;
  createEffect(() => {
    identity();
    setCached([]);
    setSearch('');
  });
  const [options] = createResource(
    () => {
      if (props.preview) return `/api/helpdesk/data/tables/${props.field.referenceTable}/options`;
      return props.workflowId
        ? `/api/helpdesk/workflows/${props.workflowId}/form-references/${props.field.id}?q=${encodeURIComponent(query())}`
        : false;
    },
    async (url) => {
      const sourceIdentity = identity();
      return { identity: sourceIdentity, rows: await api(url) };
    },
  );
  createEffect(() => {
    if (!options.error && options()?.identity === identity())
      setCached((previous) => [
        ...new Map(
          [...previous, ...options().rows].map((option) => [option.value, option]),
        ).values(),
      ]);
  });
  return (
    <div aria-busy={options.loading}>
      <ReferenceLookup
        name={props.field.id}
        label={props.field.label}
        required={props.field.required}
        value={props.value}
        onChange={props.onChange}
        onSearch={setSearch}
        options={cached()}
        disabled={props.disabled}
        placeholder="Search records…"
      />
      <Show when={options.error}>
        <ToastMessage>{options.error.message}</ToastMessage>
      </Show>
    </div>
  );
}
