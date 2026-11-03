import { createSignal } from 'solid-js';
export const [pendingConfirmation, setPendingConfirmation] = createSignal(null);
const queue = [];
const confirmedFields = new Set();
export function confirmAction(message, title = 'Confirm Removal', confirmLabel = 'Remove') {
  return new Promise((resolve) => {
    queue.push({ message, title, confirmLabel, resolve });
    if (!pendingConfirmation()) setPendingConfirmation(queue.shift());
  });
}
export function finishConfirmation(approved) {
  const current = pendingConfirmation();
  setPendingConfirmation(null);
  current?.resolve(approved);
  if (queue.length) queueMicrotask(() => setPendingConfirmation(queue.shift()));
}
export async function confirmRemovedFields(before = [], after = [], force = false) {
  const removed = before.filter((field) => !after.some((item) => item.id === field.id));
  const key = (id) => `${window.location.pathname}:${id}`;
  const unchecked = removed.filter((field) => force || !confirmedFields.has(key(field.id)));
  if (
    unchecked.length &&
    !(await confirmAction(
      `Remove ${unchecked.map((field) => `“${field.label || field.id}”`).join(', ')}? This changes the fields available in this form.`,
    ))
  )
    return false;
  removed.forEach((field) => confirmedFields.add(key(field.id)));
  return true;
}
export function clearConfirmedFields() {
  confirmedFields.clear();
}
