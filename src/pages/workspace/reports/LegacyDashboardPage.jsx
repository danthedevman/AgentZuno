import { Navigate, useLocation } from '@solidjs/router';
import { useWorkspacePath } from '../../../services/workspaceRoutes.js';
export default function LegacyDashboardPage(props) {
  const location = useLocation();
  const path = useWorkspacePath();
  const query = new URLSearchParams(location.search);
  query.set('view', props.view);
  return <Navigate href={`${path('/workspace/dashboard')}?${query}`} />;
}
