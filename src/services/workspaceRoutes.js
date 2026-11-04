import { useParams } from '@solidjs/router';
import { useSession } from '../context/SessionContext.jsx';

export function workspacePath(path = '/workspace', workspaceId) {
  if (
    typeof window !== 'undefined' &&
    /^\/demo(?:\/|$)/.test(window.location.pathname) &&
    /^\/workspace(?:[/?]|$)/.test(path)
  )
    return path.replace(/^\/workspace(?:\/[a-f0-9]{24})?/, '/demo');
  if (!workspaceId || !/^\/workspace(?:[/?]|$)/.test(path)) return path;
  if (path.startsWith(`/workspace/${workspaceId}`)) return path;
  return path.replace(/^\/workspace/, `/workspace/${workspaceId}`);
}

export function useWorkspacePath() {
  const { session } = useSession();
  const params = useParams();
  return (path) => workspacePath(path, params.workspaceId || session()?.user?.workspaceId);
}
