import DemoSettings from '../../components/DemoSettings.jsx';
import AuditSettings from '../../components/AuditSettings.jsx';
import SmtpSettings from '../../components/SmtpSettings.jsx';
import WorkforceProfile from '../../components/WorkforceProfile.jsx';
import CustomDomainSettings from '../../components/CustomDomainSettings.jsx';
import ChatSettings from '../../components/ChatSettings.jsx';
import AISettings from '../../components/AISettings.jsx';
import A from '../../components/WorkspaceLink.jsx';
import { useLocation } from '@solidjs/router';
import { Show } from 'solid-js';
import { useSession } from '../../context/SessionContext.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import IdentitySettings from '../../components/IdentitySettings.jsx';
import PageHeading from '../../components/PageHeading.jsx';

export default function AccountPage() {
  const { session } = useSession();
  const { workspace } = useWorkspace();
  const location = useLocation();
  const isSettings = () => location.pathname.endsWith('/settings');

  return (
    <section class="reading-page">
      <Show when={isSettings()}>
        <div class="connections-heading">
          <PageHeading title="Settings" />
        </div>
      </Show>
      <Show
        when={isSettings()}
        fallback={
          <Show
            when={session()?.user}
            fallback={
              <>
                <p>Sign in to see your profile and personal workspace.</p>
                <A class="workspace-button" href="/login">
                  Sign in
                </A>
              </>
            }
          >
            <WorkforceProfile showTitle userId={session()?.user?.id} />
          </Show>
        }
      >
        <ChatSettings />
        <DemoSettings />
        <SmtpSettings />
        <AuditSettings />
        <CustomDomainSettings />
        <details
          class="settings-section"
          id="ai-providers"
          name="workspace-settings"
          open={new URLSearchParams(location.search).get('section') === 'ai'}
        >
          <summary>AI providers</summary>
          <AISettings />
        </details>
        <details class="settings-section" name="workspace-settings">
          <summary>Identity provider</summary>
          <IdentitySettings />
        </details>
        <details class="settings-section" name="workspace-settings">
          <summary>Workspace</summary>
          <p>{workspace()?.name}</p>
          <p>Your records and connection settings are saved in MongoDB.</p>
        </details>
      </Show>
    </section>
  );
}
