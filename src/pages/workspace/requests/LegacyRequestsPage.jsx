import { Navigate } from '@solidjs/router';
import { useWorkspacePath } from '../../../services/workspaceRoutes.js';
export default function LegacyRequestsPage() {
  const path = useWorkspacePath();
  return <Navigate href={path('/workspace/requests')} />;
}
