import { Navigate, useParams } from '@solidjs/router';
import { useWorkspacePath } from '../../../services/workspaceRoutes.js';

export default function KnowledgeBasePage() {
  const params = useParams();
  const path = useWorkspacePath();
  return <Navigate href={path(`/workspace/knowledge?base=${encodeURIComponent(params.id)}`)} />;
}
