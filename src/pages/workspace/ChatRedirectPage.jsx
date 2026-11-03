import { useNavigate } from '@solidjs/router';
import { onMount } from 'solid-js';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
export default function ChatRedirectPage() {
  const navigate = useNavigate();
  const path = useWorkspacePath();
  onMount(() => navigate(path('/workspace/chat'), { replace: true }));
  return null;
}
