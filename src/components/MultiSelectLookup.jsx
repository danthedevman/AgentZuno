import {
  For,
  Show,
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
} from 'solid-js';
import Icon from './Icon.jsx';
import ReferenceArrow from './ReferenceArrow.jsx';

export default function MultiSelectLookup(props) {
  let container;
  let input;
  let list;
  const id = createUniqueId();
  const [localValue, setLocalValue] = createSignal(props.defaultValue || []);
  const [query, setQuery] = createSignal('');
  const [isOpen, setIsOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(0);
  const options = () => props.options || [];
  const values = () =>
    (props.value ?? localValue()).filter((value) =>
      options().some((option) => option.value === value),
    );
  const selected = () => options().filter((option) => values().includes(option.value));
  const results = () =>
    options().filter((option) => option.label.toLowerCase().includes(query().trim().toLowerCase()));
  const readOnly = () => props.readOnly || props.disabled;
  function update(values) {
    setLocalValue(values);
    props.onChange?.(values);
  }
  function select(value) {
    if (readOnly()) return;
    setIsOpen(false);
    setQuery('');
    update(
      props.single
        ? [value]
        : values().includes(value)
          ? values().filter((item) => item !== value)
          : [...values(), value],
    );
  }
  function open() {
    if (!readOnly()) {
      setActiveIndex(0);
      setIsOpen(true);
    }
  }
  function remove(value) {
    if (readOnly()) return;
    update(values().filter((item) => item !== value));
    input.focus();
    setIsOpen(false);
  }
  function handleKeyDown(event) {
    if (readOnly()) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      setIsOpen(false);
      if (event.key === 'Escape') event.preventDefault();
      return;
    }
    if (event.key === 'Backspace' && !query() && values().length) {
      event.preventDefault();
      remove(values().at(-1));
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      if (!results().length) return;
      event.preventDefault();
      if (!isOpen()) {
        open();
        return;
      }
      setActiveIndex((index) =>
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? results().length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + results().length) % results().length,
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (isOpen() && results()[activeIndex()]) select(results()[activeIndex()].value);
      else open();
    }
  }
  onMount(() => {
    const dismiss = (event) => {
      if (!container.contains(event.target)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    onCleanup(() => document.removeEventListener('pointerdown', dismiss));
  });
  createEffect(() => {
    query();
    options();
    setActiveIndex(0);
  });
  createEffect(() => {
    if (isOpen()) list?.children[activeIndex()]?.scrollIntoView({ block: 'nearest' });
  });
  createEffect(() => {
    if (readOnly()) {
      setIsOpen(false);
      setQuery('');
    }
  });
  return (
    <div
      class="multi-select-field"
      ref={container}
      onFocusOut={(event) => {
        if (!container.contains(event.relatedTarget)) setIsOpen(false);
      }}
    >
      <label for={`${id}-input`}>{props.label}</label>
      <div
        class="multi-select-control"
        data-readonly={!!props.readOnly}
        data-disabled={!!props.disabled}
      >
        <For each={selected()}>
          {(option) => (
            <span class="selection-pill">
              <span>{option.label}</span>
              <Show when={!readOnly()}>
                <button
                  type="button"
                  aria-label={`Remove ${option.label}`}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    remove(option.value);
                  }}
                >
                  <Icon name="close" />
                </button>
              </Show>
            </span>
          )}
        </For>
        <For each={values()}>
          {(value) => (
            <input type="hidden" name={props.name} value={value} disabled={props.disabled} />
          )}
        </For>
        <input
          class="multi-select-input"
          aria-label={props.label}
          data-reference
          data-required={!!props.required}
          data-selected-count={values().length}
          ref={input}
          id={`${id}-input`}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen()}
          aria-controls={`${id}-list`}
          aria-activedescendant={
            isOpen() && results().length ? `${id}-${activeIndex()}` : undefined
          }
          aria-readonly={!!props.readOnly}
          placeholder={
            props.readOnly
              ? selected().length
                ? ''
                : 'No knowledge bases available'
              : selected().length
                ? 'Add more…'
                : props.placeholder || 'Search and select…'
          }
          value={query()}
          readonly={props.readOnly}
          disabled={props.disabled}
          required={props.required && !values().length}
          autocomplete="off"
          onFocus={open}
          onClick={open}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            open();
          }}
          onKeyDown={handleKeyDown}
        />
        <span class="reference-open-actions">
          <For each={selected()}>
            {(option) => <ReferenceArrow href={option.href} label={option.label} />}
          </For>
        </span>
      </div>
      <span class="sr-only" role="status">
        {values().length} selected
      </span>
      <Show when={isOpen()}>
        <div
          class="category-options multi-select-options"
          role="listbox"
          aria-label={props.label}
          aria-multiselectable={!props.single}
          id={`${id}-list`}
          ref={list}
        >
          <For each={results()}>
            {(option, index) => (
              <div
                classList={{ 'category-option': true, 'is-active': activeIndex() === index() }}
                role="option"
                id={`${id}-${index()}`}
                aria-selected={values().includes(option.value)}
                onPointerMove={() => setActiveIndex(index())}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  select(option.value);
                }}
              >
                <span>{option.label}</span>
                <Show when={values().includes(option.value)}>
                  <Icon name="check" />
                </Show>
              </div>
            )}
          </For>
          <Show when={!results().length}>
            <p class="lookup-empty">No matches found.</p>
          </Show>
        </div>
      </Show>
    </div>
  );
}
