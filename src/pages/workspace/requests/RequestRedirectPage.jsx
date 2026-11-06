import { createResource, createEffect, Show } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import { api } from '../../../services/api.js';
import { useWorkspacePath } from '../../../services/workspaceRoutes.js';
import Skeleton from '../../../components/Skeleton.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
export default function RequestRedirectPage() {
  const params = useParams();
  const navigate = useNavigate();
  const path = useWorkspacePath();
  const [request] = createResource(
    () => params.id,
    async (id) => {
      const item = await api(`/api/helpdesk/requests/${id}`);
      if (item.chatId) return item.chatId;
      return (await api(`/api/helpdesk/requests/${id}/review`, { method: 'POST', body: '{}' }))
        .chatId;
    },
  );
  createEffect(() => {
    if (!request.error && request())
      navigate(path(`/workspace/chat/${request()}?request=${params.id}`), { replace: true });
  });
  return (
    <Show when={request.error} fallback={<Skeleton label="Opening request workspace" lines={4} />}>
      <ToastMessage tone="error">{request.error?.message}</ToastMessage>
    </Show>
  );
}
