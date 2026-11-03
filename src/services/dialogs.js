const openDialogs = new Map();
let previousBodyOverflow;
let previousRootOverflow;

export function openDialog(dialog) {
  for (const open of openDialogs.keys()) open.close();
  if (!openDialogs.size) {
    previousBodyOverflow = document.body.style.overflow;
    previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }
  const trigger = document.activeElement;
  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
    }
    if (event.key !== 'Tab') return;
    const targets = [
      ...dialog.querySelectorAll(
        'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
      ),
    ].filter((element) => element.getClientRects().length);
    const first = targets[0];
    const last = targets.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  openDialogs.set(dialog, { trigger, handleKeyDown });
  dialog.addEventListener('keydown', handleKeyDown);
  dialog.show();
  (dialog.querySelector('[autofocus]') || dialog.querySelector('button, input, a[href]'))?.focus();
}

export function releaseDialog(dialog) {
  const state = openDialogs.get(dialog);
  if (!state) return;
  dialog.removeEventListener('keydown', state.handleKeyDown);
  openDialogs.delete(dialog);
  if (openDialogs.size) return;
  document.body.style.overflow = previousBodyOverflow;
  document.documentElement.style.overflow = previousRootOverflow;
  if (document.activeElement === document.body || dialog.contains(document.activeElement))
    state.trigger?.focus();
}
