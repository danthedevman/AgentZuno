import { createEffect, onCleanup } from 'solid-js';

export function startConversationPolling(refresh, { delay = 700, canRefresh = () => true } = {}) {
  let stopped = false;
  let timer;
  async function poll() {
    try {
      if (canRefresh()) await refresh();
    } catch {
      // The resource exposes its error; keep status recovery available after a transient failure.
    } finally {
      if (!stopped) timer = setTimeout(poll, delay);
    }
  }
  timer = setTimeout(poll, delay);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
export function pollConversation(active, refresh) {
  createEffect(() => {
    if (!active()) return;
    onCleanup(
      startConversationPolling(refresh, {
        canRefresh: () => document.visibilityState === 'visible',
      }),
    );
  });
}
