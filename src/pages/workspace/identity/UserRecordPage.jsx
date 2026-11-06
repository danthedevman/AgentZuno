import UserMembershipSettings from '../../../components/identity/UserMembershipSettings.jsx';
import BackLink from '../../../components/BackLink.jsx';
import { Show } from 'solid-js';
import { useParams } from '@solidjs/router';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import WorkforceProfile from '../../../components/identity/WorkforceProfile.jsx';
export default function UserRecordPage() {
  const params = useParams();
  const { access } = useWorkspace();
  return (
    <section class="reading-page">
      <BackLink href="/workspace/users">Users</BackLink>
      <Show when={access()?.role === 'admin'}>
        <WorkforceProfile userId={params.userId} showTitle />
        <UserMembershipSettings userId={params.userId} />
      </Show>
    </section>
  );
}
