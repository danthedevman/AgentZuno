import { api } from '../../services/api.js';
import { Show, createEffect, createResource } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
import RequestsPage from './RequestsPage.jsx';
export default function DashboardPage() {
  const { access } = useWorkspace();
  const navigate = useNavigate();
  const path = useWorkspacePath();
  const [inboxState] = createResource(
    () => !access.error && access() && `${access().workspaceId}:${access().role}`,
    () => api('/api/helpdesk/inbox/unread'),
  );
  const isOperator = () =>
    !access.error &&
    (['admin', 'agent', 'read-only'].includes(access()?.role) ||
      access()?.canApprove ||
      (!inboxState.error && inboxState()?.hasMentions));
  createEffect(() => {
    if (!access.error && access() && !inboxState.loading && !isOperator())
      navigate(path('/workspace/chat'), { replace: true });
  });
  return (
    <Show when={isOperator()}>
      <RequestsPage inbox />
    </Show>
  );
}
