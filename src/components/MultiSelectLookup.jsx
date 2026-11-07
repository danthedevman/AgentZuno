import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { useWorkspacePath } from '../services/workspaceRoutes.js';
import { referenceCreationPath, referenceTypeFromOptions } from '../services/referenceCreation.js';
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
  const workspaceContext = useWorkspace();
  const path = useWorkspacePath();
  const createHref = () => {
    const role = workspaceContext?.access?.()?.role;
    const target = props.referenceTable
      ? referenceCreationPath(props.referenceTable, role)
      : referenceCreationPath(props.name, role) ||
        referenceCreationPath(referenceTypeFromOptions(props.options), role);
    return target ? path(target) : '';
  };
  const [refreshing, setRefreshing] = createSignal(false);
  const [refreshFailed, setRefreshFailed] = createSignal(false);
  let createLink;
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
    refreshing() || refreshFailed()
      ? []
      : options().filter((option) =>
          option.label.toLowerCase().includes(query().trim().toLowerCase()),
        );
  const readOnly = () => props.readOnly || props.disabled;
  function update(values) {
    setLocalValue(values);
    props.onChange?.(values);
  }
  function select(value) {
    if (
      readOnly() ||
      refreshing() ||
      refreshFailed() ||
      !results().some((option) => option.value === value)
    )
      return;
    setIsOpen(false);
    setQuery('');
    props.onSearch?.('');
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
      if (!isOpen()) {
        const refresh = props.onOpen || workspaceContext?.refresh;
        setRefreshing(true);
        setRefreshFailed(false);
        Promise.resolve()
          .then(() => refresh?.())
          .catch(() => setRefreshFailed(true))
          .finally(() => setRefreshing(false));
      }
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
    if (event.key === 'Tab' && !event.shiftKey && isOpen() && createHref()) {
      event.preventDefault();
      createLink?.focus();
      return;
    }
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
              <ReferenceArrow href={option.href} label={option.label} />
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
                : props.placeholder || 'None selected'
              : selected().length
                ? props.single
                  ? 'Change selection…'
                  : 'Add more…'
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
            props.onSearch?.(event.currentTarget.value);
            open();
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      <span class="sr-only" role="status">
        {values().length} selected
      </span>
      <Show when={isOpen()}>
        <div class="category-options multi-select-options">
          <Show when={refreshing()}>
            <p class="lookup-empty" role="status">
              Refreshing options…
            </p>
          </Show>
          <div
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
            <Show when={!refreshing() && !results().length}>
              <p class="lookup-empty">
                {refreshFailed()
                  ? 'Options could not be refreshed. Close and reopen to retry.'
                  : 'No matches found.'}
              </p>
            </Show>
          </div>
          <Show when={createHref() && !readOnly()}>
            <a
              ref={createLink}
              class="reference-create-link"
              href={createHref()}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                event.stopPropagation();
                setIsOpen(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape' || event.key === 'Tab') setIsOpen(false);
              }}
            >
              <Icon name="plus" />
              Create new…<span class="sr-only">{props.label}, opens in a new tab</span>
            </a>
          </Show>
        </div>
      </Show>
    </div>
  );
}
