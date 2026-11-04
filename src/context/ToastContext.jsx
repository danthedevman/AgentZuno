import {
  createContext,
  createEffect,
  createSignal,
  For,
  Show,
  onCleanup,
  useContext,
} from 'solid-js';
import Icon from '../components/Icon.jsx';
import { useLocation } from '@solidjs/router';
const ToastContext = createContext();
export function ToastProvider(props) {
  const [toasts, setToasts] = createSignal([]);
  const timers = new Map();
  const location = useLocation();
  let previousRoute = `${location.pathname}${location.search}`;
  createEffect(() => {
    const route = `${location.pathname}${location.search}`;
    if (route === previousRoute) return;
    previousRoute = route;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    setToasts([]);
  });
  function dismiss(id) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    setToasts((items) => items.filter((item) => item.id !== id));
  }
  function notify(input) {
    const id = input.id || crypto.randomUUID();
    clearTimeout(timers.get(id));
    setToasts((items) => [...items.filter((item) => item.id !== id).slice(-3), { ...input, id }]);
    timers.set(
      id,
      setTimeout(() => dismiss(id), input.tone === 'error' ? 10000 : 6000),
    );
    return id;
  }
  onCleanup(() => {
    for (const timer of timers.values()) clearTimeout(timer);
  });
  return (
    <ToastContext.Provider value={{ notify, dismiss }}>
      {props.children}
      <div class="toast-region" aria-label="Notifications">
        <For each={toasts()}>
          {(toast) => (
            <section
              class="toast-message"
              data-tone={toast.tone || 'info'}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              aria-atomic="true"
              onMouseEnter={() => clearTimeout(timers.get(toast.id))}
              onFocusIn={() => clearTimeout(timers.get(toast.id))}
            >
              <div class="toast-content">
                <Show when={toast.title}>
                  <strong>{toast.title}</strong>
                </Show>
                <div>{toast.message}</div>
                <Show when={toast.action}>
                  <button type="button" class="toast-action" onClick={toast.action}>
                    {toast.actionLabel || 'Review fields'}
                  </button>
                </Show>
              </div>
              <button
                class="toast-dismiss"
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismiss(toast.id)}
              >
                <Icon name="close" />
              </button>
            </section>
          )}
        </For>
      </div>
    </ToastContext.Provider>
  );
}
export function useToasts() {
  const context = useContext(ToastContext);
  let active = true;
  onCleanup(() => {
    active = false;
  });
  return { ...context, notify: (input) => (active ? context.notify(input) : undefined) };
}
