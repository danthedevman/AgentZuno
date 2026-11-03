import { createSignal, onMount, onCleanup } from 'solid-js';
import { useBeforeLeave, useLocation } from '@solidjs/router';
import { confirmAction } from '../services/confirmations.js';
export default function UnsavedChangesGuard() {
  const location = useLocation();
  const [dirty, setDirty] = createSignal(false);
  let pending = false;
  const edit = (event) => {
    const field = event.target;
    if (
      field.closest(
        '.workspace-search, .record-pagination, .knowledge-tabs, .inbox-status-filters',
      ) ||
      field.matches('input[type="search"]')
    )
      return;
    if (
      field.closest(
        'form, .article-editor, .workflow-code-editor, .workflow-form-field, .knowledge-permissions',
      )
    )
      setDirty(true);
  };
  const toggle = (event) => {
    if (
      event.target.closest('button[role="switch"], .workflow-form-field button[aria-pressed]') ||
      (event.target.closest('[role="option"]') &&
        event.target.closest('form, .workflow-design, .knowledge-permissions'))
    )
      setDirty(true);
  };
  const saved = () => setDirty(false);
  const unload = (event) => {
    if (dirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  onMount(() => {
    document.addEventListener('click', toggle);
    document.addEventListener('input', edit);
    document.addEventListener('change', edit);
    window.addEventListener('agentzuno-form-saved', saved);
    window.addEventListener('beforeunload', unload);
  });
  onCleanup(() => {
    document.removeEventListener('click', toggle);
    document.removeEventListener('input', edit);
    document.removeEventListener('change', edit);
    window.removeEventListener('agentzuno-form-saved', saved);
    window.removeEventListener('beforeunload', unload);
  });
  useBeforeLeave((event) => {
    if (
      !dirty() ||
      (typeof event.to === 'string' && event.to.split('?')[0].split('#')[0] === location.pathname)
    )
      return;
    event.preventDefault();
    if (pending) return;
    pending = true;
    confirmAction(
      'You have unsaved changes. Leave this page and discard them?',
      'Unsaved Changes',
      'Leave Page',
    ).then((leave) => {
      pending = false;
      if (leave) {
        setDirty(false);
        event.retry(true);
      }
    });
  });
  return null;
}
