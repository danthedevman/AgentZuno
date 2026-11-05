import {
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  createUniqueId,
  untrack,
  onCleanup,
} from 'solid-js';
import { api } from '../services/api.js';

export default function MentionTextarea(props) {
  let textarea;
  const listId = createUniqueId();
  const [query, setQuery] = createSignal(null);
  const [search, setSearch] = createSignal(null);
  const [start, setStart] = createSignal(0);
  const [active, setActive] = createSignal(0);
  const [selections, setSelections] = createSignal({});
  const endpoint = () =>
    props.mentionEndpoint || `/api/helpdesk/requests/${props.requestId}/mention-options`;
  const selectionKey = () => `${endpoint()}:${props.kind}`;
  const selected = () => selections()[selectionKey()] || [];
  const setSelected = (value) =>
    setSelections((current) => ({ ...current, [selectionKey()]: value }));
  createEffect(() => {
    endpoint();
    props.kind;
    setQuery(null);
    props.onMentionsChange(untrack(selected).map((person) => person.value));
  });
  createEffect(() => {
    if (!props.value && untrack(selected).length) {
      setSelected([]);
      props.onMentionsChange([]);
    }
  });
  createEffect(() => {
    const value = query();
    const timer = setTimeout(() => {
      setSearch(value);
      setActive(0);
    }, 200);
    onCleanup(() => clearTimeout(timer));
  });
  const [options] = createResource(
    () => search() !== null && `${endpoint()}:${props.kind}:${search()}`,
    () =>
      api(
        `${endpoint()}?${new URLSearchParams({ kind: props.kind, q: search(), ...(props.tableId ? { tableId: props.tableId } : {}) })}`,
      ),
  );
  const visibleOptions = () =>
    query() !== null && !options.loading && !options.error ? options() || [] : [];
  function update(value) {
    const remaining = selected().filter((person) => value.includes('@' + person.label));
    setSelected(remaining);
    props.onMentionsChange(remaining.map((person) => person.value));
    props.onInput(value);
  }
  function input(event) {
    const value = event.currentTarget.value;
    update(value);
    const prefix = value.slice(0, event.currentTarget.selectionStart);
    const index = prefix.lastIndexOf('@');
    const fragment = prefix.slice(index + 1);
    if (
      index >= 0 &&
      (index === 0 || /\s/.test(prefix[index - 1])) &&
      fragment.length <= 60 &&
      !fragment.includes('\n')
    ) {
      setStart(index);
      setQuery(fragment);
    } else setQuery(null);
  }
  function choose(person) {
    const position = textarea.selectionStart;
    const value = `${props.value.slice(0, start())}@${person.label} ${props.value.slice(position)}`;
    const people = [...selected().filter((item) => item.value !== person.value), person].slice(
      0,
      10,
    );
    setSelected(people);
    props.onInput(value);
    props.onMentionsChange(people.map((item) => item.value));
    setQuery(null);
    textarea.focus();
    const cursor = start() + person.label.length + 2;
    textarea.setSelectionRange(cursor, cursor);
  }
  return (
    <span class="mention-composer">
      <textarea
        ref={textarea}
        id={props.id}
        name={props.name}
        required={props.required}
        maxlength={props.maxlength}
        rows={props.rows}
        value={props.value}
        onInput={input}
        aria-autocomplete="list"
        aria-controls={visibleOptions().length ? listId : undefined}
        aria-activedescendant={visibleOptions().length ? `${listId}-${active()}` : undefined}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setQuery(null);
            return;
          }
          const people = visibleOptions();
          if (!people.length) return;
          if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
            event.preventDefault();
            if (event.key === 'Enter') choose(people[active() % people.length]);
            else
              setActive(
                (index) =>
                  (index + (event.key === 'ArrowDown' ? 1 : -1) + people.length) % people.length,
              );
          }
        }}
        onBlur={() => setQuery(null)}
      />
      <Show when={visibleOptions().length}>
        <span class="mention-options" role="listbox" aria-label="Mention a person" id={listId}>
          <For each={visibleOptions()}>
            {(person, index) => (
              <button
                type="button"
                role="option"
                id={`${listId}-${index()}`}
                aria-selected={active() === index()}
                onPointerDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  choose(person);
                }}
              >
                @{person.label}
              </button>
            )}
          </For>
        </span>
      </Show>
    </span>
  );
}
