import { createEffect, createResource } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import { api } from '../../../services/api.js';
import { useWorkspacePath } from '../../../services/workspaceRoutes.js';
import Skeleton from '../../../components/Skeleton.jsx';
export default function LegacyQueuePage() {
  const params = useParams();
  const navigate = useNavigate();
  const path = useWorkspacePath();
  const [queue] = createResource(
    () => params.id !== 'new' && params.id,
    (id) => api(`/api/helpdesk/queues/${id}`),
  );
  createEffect(() => {
    if (params.id === 'new') navigate(path('/workspace/users/groups/new'), { replace: true });
    else if (queue()?.groupId)
      navigate(path(`/workspace/users/groups/${queue().groupId}`), { replace: true });
  });
  return <Skeleton label="Opening group" lines={3} />;
}
