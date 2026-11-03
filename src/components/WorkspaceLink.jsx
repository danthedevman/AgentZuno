import { A } from '@solidjs/router';
import { useWorkspacePath } from '../services/workspaceRoutes.js';

export default function WorkspaceLink(props) {
  const path = useWorkspacePath();
  return <A {...props} href={path(props.href)} />;
}
