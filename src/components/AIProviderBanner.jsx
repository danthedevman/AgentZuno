import { createResource, onMount, onCleanup, Show } from 'solid-js';
import { useParams } from '@solidjs/router';
import { useWorkspace } from '../context/WorkspaceContext.jsx';
import { api } from '../services/api.js';
import A from './WorkspaceLink.jsx';
export default function AIProviderBanner() {
  const params = useParams();
  const { access } = useWorkspace();
  const [status, { refetch }] = createResource(
    () => access() && `${params.workspaceId}:${access()?.role}`,
    () => api('/api/helpdesk/ai-status'),
  );
  onMount(() => window.addEventListener('ai-settings-changed', refetch));
  onCleanup(() => window.removeEventListener('ai-settings-changed', refetch));
  return (
    <Show when={!status.error && status() && !status().enabled}>
      <div class="ai-provider-banner" role="status">
        AI is not enabled.{' '}
        <Show
          when={access()?.role === 'admin'}
          fallback={<span>Ask your workspace administrator to connect a provider.</span>}
        >
          <A href="/workspace/settings?section=ai#ai-providers">Connect an AI Provider</A>
        </Show>
      </div>
    </Show>
  );
}
