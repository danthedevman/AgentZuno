import { createSignal, createUniqueId } from 'solid-js';

export default function Toggle(props) {
  const id = createUniqueId();
  const [localValue, setLocalValue] = createSignal(!!props.defaultChecked);
  const checked = () => props.checked ?? localValue();
  function toggle() {
    const next = !checked();
    setLocalValue(next);
    props.onChange?.(next);
  }
  return (
    <div class="toggle-field">
      <input
        type="hidden"
        name={props.name}
        value={checked() ? 'on' : 'off'}
        disabled={props.disabled}
      />
      <span id={`${id}-label`}>{props.label}</span>
      <button
        class="toggle-switch"
        type="button"
        role="switch"
        aria-labelledby={`${id}-label`}
        aria-checked={checked()}
        disabled={props.disabled}
        onClick={toggle}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}
