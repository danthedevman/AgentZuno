import { useToasts } from '../context/ToastContext.jsx';
import { For, Show, createSignal, createUniqueId, onCleanup, onMount, splitProps } from 'solid-js';
import { Portal } from 'solid-js/web';
import { validateValue } from '../services/formValidation.js';

export default function ValidatedForm(props) {
  const [local, attributes] = splitProps(props, [
    'children',
    'onSubmit',
    'ref',
    'validationRef',
    'validateField',
  ]);
  let form;
  const { notify, dismiss } = useToasts();
  const noticeId = createUniqueId();
  const [markers, setMarkers] = createSignal([]);
  let observer;
  let resizeObserver;
  let markerFrame;
  function alignMarkers() {
    cancelAnimationFrame(markerFrame);
    markerFrame = requestAnimationFrame(() => {
      for (const marker of form.querySelectorAll('.required-marker')) {
        const label = marker.closest('[data-required-label="true"]');
        if (!label) continue;
        const text = [...label.childNodes].find(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
        );
        if (!text) continue;
        const range = document.createRange();
        range.selectNodeContents(text);
        const line = range.getBoundingClientRect();
        if (line.height)
          marker.style.top = `${line.top - label.getBoundingClientRect().top + line.height / 2}px`;
      }
    });
  }
  const prefix = createUniqueId();
  const [errors, setErrors] = createSignal([]);
  const knownFields = new Set();
  const controls = () =>
    [
      ...form.querySelectorAll(
        'input, textarea, [data-validation-field], [data-validate-dropdown]',
      ),
    ].filter(
      (field) =>
        (!field.disabled ||
          (field.hasAttribute('data-validate-dropdown') &&
            field.dataset.required === 'true' &&
            field.dataset.selectedCount === '0')) &&
        field.type !== 'hidden' &&
        !['checkbox', 'radio'].includes(field.type) &&
        !field.closest('[hidden]'),
    );
  function labelNode(field) {
    return (
      field.labels?.[0] ||
      field.closest('label') ||
      document.getElementById(field.getAttribute('aria-labelledby')?.split(' ')[0]) ||
      field.closest('.article-body-field')?.querySelector(':scope > span')
    );
  }
  function updateMarkers() {
    const required = [];
    const labels = new Set();
    for (const field of controls()) {
      const label = labelNode(field);
      if (!label) continue;
      const isRequired = field.required || field.dataset.required === 'true';
      if (isRequired && !labels.has(label)) {
        labels.add(label);
        label.dataset.requiredLabel = 'true';
        required.push({ label, field });
      }
      label.dataset.fieldInvalid = field.getAttribute('aria-invalid') === 'true' ? 'true' : 'false';
      if (field.dataset.required === 'true') field.setAttribute('aria-required', 'true');
    }
    for (const previous of markers())
      if (!labels.has(previous.label)) {
        delete previous.label.dataset.requiredLabel;
        delete previous.label.dataset.fieldInvalid;
      }
    const previous = markers();
    if (
      previous.length !== required.length ||
      required.some((item, index) => item.field !== previous[index].field)
    )
      setMarkers(required);
    alignMarkers();
  }
  onMount(() => {
    updateMarkers();
    observer = new MutationObserver(updateMarkers);
    observer.observe(form, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['required', 'data-required', 'aria-invalid'],
    });
    resizeObserver = new ResizeObserver(alignMarkers);
    resizeObserver.observe(form);
  });
  function fieldLabel(field) {
    const label =
      field.getAttribute('aria-label') ||
      labelNode(field)?.childNodes[0]?.textContent ||
      field.name ||
      'This field';
    return label.trim().replace(/\s+/g, ' ').slice(0, 80);
  }
  function inspect(field) {
    const label = fieldLabel(field);
    const reference =
      field.hasAttribute('data-reference') || field.hasAttribute('data-validate-dropdown');
    const required = field.required || field.dataset.required === 'true';
    const message =
      local.validateField?.(field, form) ||
      validateValue({
        label,
        type: field.type,
        value: field.dataset.validationValue ?? field.value,
        required,
        reference,
        selectedCount: Number(field.dataset.selectedCount || 0),
        minLength: field.minLength,
        maxLength: Number(field.dataset.maxLength || field.maxLength),
        min: field.min ? Number(field.min) : undefined,
        max: field.max ? Number(field.max) : undefined,
        step: field.step,
        pattern: field.pattern,
        file: field.files?.[0],
        accept: field.accept,
        maxBytes: Number(field.dataset.maxBytes) || undefined,
      });
    if (!field.id) field.id = `${prefix}-field-${knownFields.size}`;
    knownFields.add(field);
    const errorId = `${field.id}-error`;
    field.setAttribute('aria-invalid', message ? 'true' : 'false');
    const described = (field.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter((id) => id && id !== errorId);
    if (message) described.push(errorId);
    if (described.length) field.setAttribute('aria-describedby', described.join(' '));
    else field.removeAttribute('aria-describedby');
    const host =
      field.closest('.multi-select-field, .article-body-field, .file-upload-field, label') ||
      field.parentElement;
    return message ? { field, message, label, errorId, host } : null;
  }
  function applyErrors(next, announce = false) {
    setErrors(next);
    if (!next.length) {
      dismiss(noticeId);
      return;
    }
    if (announce)
      notify({
        id: noticeId,
        tone: 'error',
        title: next.length === 1 ? 'Check this field' : `Check ${next.length} fields`,
        message: next.map((error) => `${error.label}: ${error.message}`).join(' · '),
        action: () => next[0].field.isConnected && next[0].field.focus(),
        actionLabel: 'Review fields',
      });
  }
  function revisit() {
    if (!errors().length) return;
    queueMicrotask(() => {
      if (!form?.isConnected) return;
      const previous = errors();
      const remaining = previous.filter((error) => error.field.isConnected && inspect(error.field));
      applyErrors(remaining, remaining.length !== previous.length);
    });
  }
  function validateAndFocus(filter = () => true) {
    const fields = controls().filter(filter);
    applyErrors(fields.map(inspect).filter(Boolean), true);
    if (errors().length) {
      errors()[0].field.focus();
      return false;
    }
    return true;
  }
  function submit(event) {
    event.preventDefault();
    if (validateAndFocus()) local.onSubmit?.(event);
  }
  onCleanup(() => {
    observer?.disconnect();
    resizeObserver?.disconnect();
    cancelAnimationFrame(markerFrame);
    knownFields.clear();
  });
  return (
    <form
      {...attributes}
      ref={(element) => {
        form = element;
        local.ref?.(element);
        local.validationRef?.(validateAndFocus);
      }}
      noValidate
      onSubmit={submit}
      onInput={revisit}
      onChange={revisit}
      onKeyUp={revisit}
      onReset={() => {
        for (const field of knownFields) {
          field.removeAttribute('aria-invalid');
          const errorId = `${field.id}-error`;
          const described = (field.getAttribute('aria-describedby') || '')
            .split(/\s+/)
            .filter((id) => id && id !== errorId);
          if (described.length) field.setAttribute('aria-describedby', described.join(' '));
          else field.removeAttribute('aria-describedby');
        }
        applyErrors([]);
        queueMicrotask(updateMarkers);
      }}
    >
      {local.children}
      <For each={markers()}>
        {(marker) => (
          <Portal mount={marker.label}>
            <span class="required-marker" aria-hidden="true">
              <span class="required-symbol">*</span>
            </span>
          </Portal>
        )}
      </For>
      <For each={errors()}>
        {(error) => (
          <Portal mount={error.host}>
            <span class="sr-only" id={error.errorId}>
              {error.message}
            </span>
          </Portal>
        )}
      </For>
    </form>
  );
}
