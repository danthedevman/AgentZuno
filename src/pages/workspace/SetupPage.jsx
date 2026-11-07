import Icon from '../../components/Icon.jsx';
import { createSignal, For, Show } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
import AISettings from '../../components/settings/AISettings.jsx';
import A from '../../components/WorkspaceLink.jsx';
import PageHeading from '../../components/PageHeading.jsx';
export default function SetupPage() {
  const params = useParams();
  const { access } = useWorkspace();
  const [step, setStep] = createSignal(0);
  const navigate = useNavigate(),
    path = useWorkspacePath();
  const finish = () => {
    const key = `agentzuno-setup-next:${params.workspaceId || ''}`;
    const next = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    navigate(next?.startsWith('/workspace/') ? next : path('/workspace'), { replace: true });
  };
  return (
    <section class="reading-page setup-page">
      <div class="connections-heading">
        <PageHeading title="Set Up Your Workspace" />
        <button class="workspace-button secondary" onClick={finish}>
          Skip Setup
        </button>
      </div>
      <Show
        when={access()?.role === 'admin'}
        fallback={
          <Show when={access()}>
            <A href="/workspace">Open Workspace</A>
          </Show>
        }
      >
        <ol class="setup-steps">
          <For each={['AI Provider', 'Connect Your Channels', 'Knowledge and Demo Data']}>
            {(label, index) => (
              <li aria-current={step() === index() ? 'step' : undefined}>
                <button type="button" onClick={() => setStep(index())}>
                  {index() + 1}. {label}
                </button>
              </li>
            )}
          </For>
        </ol>
        <Show when={step() === 0}>
          <AISettings />
        </Show>
        <Show when={step() === 1}>
          <p>Connect the channels your employees use to reach support.</p>
          <A class="workspace-button secondary" href="/workspace/connectors">
            Configure Connectors
          </A>
          <A class="workspace-button secondary" href="/workspace/settings">
            Identity and Email Settings
          </A>
        </Show>
        <Show when={step() === 2}>
          <p>
            Add your team's knowledge or load a removable demo dataset to explore the workspace.
          </p>
          <A class="workspace-button secondary" href="/workspace/knowledge">
            Open Knowledge
          </A>
          <A class="workspace-button secondary" href="/workspace/settings?section=demo">
            Configure Demo Data
          </A>
        </Show>
        <div class="helpdesk-actions">
          <Show when={step() > 0}>
            <button class="workspace-button secondary" onClick={() => setStep(step() - 1)}>
              Back
            </button>
          </Show>
          <button
            class="workspace-button secondary"
            onClick={() => (step() < 2 ? setStep(step() + 1) : finish())}
          >
            Skip This Step
          </button>
          <button
            class="workspace-button"
            onClick={() => (step() < 2 ? setStep(step() + 1) : finish())}
          >
            <Icon name="arrow" />

            {step() < 2 ? 'Continue' : 'Open Workspace'}
          </button>
        </div>
      </Show>
    </section>
  );
}
