import {
  For,
  Show,
  createEffect,
  createSignal,
  createUniqueId,
  onMount,
  onCleanup,
} from 'solid-js';
import Icon from './Icon.jsx';

export default function Dropdown(props) {
  let container;
  let list;
  const id = createUniqueId();
  const [isOpen, setIsOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [localValue, setLocalValue] = createSignal(props.defaultValue);
  const options = () => props.options || [];
  const canOpen = () => options().length > 1 || (props.allowSingleOption && options().length === 1);
  const value = () => props.value ?? localValue() ?? options()[0]?.value ?? '';
  const label = (value) =>
    options().find((option) => option.value === value)?.label || props.placeholder || 'Select';

  function open() {
    if (props.disabled || props.readOnly || !canOpen()) return;
    setActiveIndex(
      Math.max(
        0,
        options().findIndex((option) => option.value === value()),
      ),
    );
    setIsOpen(true);
  }

  function select(value) {
    setIsOpen(false);
    setLocalValue(value);
    props.onChange?.(value);
  }

  function handleKeyDown(event) {
    if (props.readOnly || !canOpen()) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      setIsOpen(false);
      if (event.key === 'Escape') event.preventDefault();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (!isOpen()) {
        open();
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') select(options()[activeIndex()].value);
      else if (event.key === 'Home') setActiveIndex(0);
      else if (event.key === 'End') setActiveIndex(options().length - 1);
      else
        setActiveIndex(
          (index) =>
            (index + (event.key === 'ArrowDown' ? 1 : -1) + options().length) % options().length,
        );
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const index = options().findIndex((value) =>
        value.label.toLowerCase().startsWith(event.key.toLowerCase()),
      );
      if (index >= 0) {
        event.preventDefault();
        setIsOpen(true);
        setActiveIndex(index);
      }
    }
  }

  onMount(() => {
    function dismiss(event) {
      if (!container.contains(event.target)) setIsOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    onCleanup(() => document.removeEventListener('pointerdown', dismiss));
  });

  createEffect(() => {
    if (isOpen()) list?.children[activeIndex()]?.scrollIntoView({ block: 'nearest' });
  });

  return (
    <div
      class="category-dropdown shared-dropdown"
      classList={{ 'is-icon-only': props.iconOnly }}
      ref={container}
      onFocusOut={(event) => {
        if (!container.contains(event.relatedTarget)) setIsOpen(false);
      }}
    >
      <input type="hidden" name={props.name} value={value()} disabled={props.disabled} />
      <button
        disabled={props.disabled || !options().length}
        aria-readonly={props.readOnly || !canOpen()}
        class="category-trigger"
        type="button"
        role="combobox"
        data-validate-dropdown
        data-required={props.required ?? true}
        data-selected-count={options().some((option) => option.value === value()) ? 1 : 0}
        aria-label={props.ariaLabel}
        aria-description={props.iconOnly ? label(value()) : undefined}
        title={props.iconOnly ? `${props.ariaLabel || 'Select'}: ${label(value())}` : undefined}
        aria-haspopup="listbox"
        aria-expanded={isOpen()}
        aria-controls={`${id}-list`}
        aria-activedescendant={isOpen() ? `${id}-${activeIndex()}` : undefined}
        onClick={() => (isOpen() ? setIsOpen(false) : open())}
        onKeyDown={handleKeyDown}
      >
        <Show when={props.icon}>
          <Icon name={props.icon} />
        </Show>
        <Show when={!props.iconOnly}>
          <span>{label(value())}</span>
          <span classList={{ 'category-chevron': true, 'is-open': isOpen() }}>
            <Icon name="arrow" />
          </span>
        </Show>
      </button>
      <Show when={isOpen()}>
        <div
          class="category-options"
          role="listbox"
          aria-label={props.ariaLabel}
          id={`${id}-list`}
          ref={list}
        >
          <For each={options()}>
            {(option, index) => (
              <div
                role="option"
                id={`${id}-${index()}`}
                aria-selected={value() === option.value}
                aria-label={option.ariaLabel || option.label}
                classList={{ 'category-option': true, 'is-active': activeIndex() === index() }}
                onPointerMove={() => setActiveIndex(index())}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  // Prevent an enclosing label from clicking the trigger again.
                  event.preventDefault();
                  event.stopPropagation();
                  select(option.value);
                }}
              >
                <span>{option.label}</span>
                <Show when={value() === option.value}>
                  <Icon name={props.selectedIcon || 'check'} />
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
