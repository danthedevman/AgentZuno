import { children, createEffect, createUniqueId, onCleanup } from 'solid-js';
import { useToasts } from '../context/ToastContext.jsx';
export default function ToastMessage(props) {
  const { notify, dismiss } = useToasts();
  const id = createUniqueId();
  const content = children(() => props.children);
  createEffect(() => {
    const message = props.message ?? content();
    if (message) notify({ id, message, tone: props.tone || 'error' });
  });
  onCleanup(() => dismiss(id));
  return null;
}
