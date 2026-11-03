import { Show, createEffect } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
import RequestsPage from './RequestsPage.jsx';
export default function DashboardPage() {
  const { access } = useWorkspace();
  const navigate = useNavigate();
  const path = useWorkspacePath();
  const isOperator = () =>
    !access.error &&
    (['admin', 'agent', 'read-only'].includes(access()?.role) || access()?.canApprove);
  createEffect(() => {
    if (!access.error && access() && !isOperator())
      navigate(path('/workspace/chat'), { replace: true });
  });
  return (
    <Show when={isOperator()}>
      <RequestsPage inbox />
    </Show>
  );
}
