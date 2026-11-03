import BackLink from '../../components/BackLink.jsx';
import { Show } from 'solid-js';
import { useParams } from '@solidjs/router';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import WorkforceProfile from '../../components/WorkforceProfile.jsx';
import PageHeading from '../../components/PageHeading.jsx';
import A from '../../components/WorkspaceLink.jsx';
export default function UserRecordPage() {
  const params = useParams();
  const { access } = useWorkspace();
  return (
    <section class="reading-page">
      <BackLink href="/workspace/users">Users</BackLink>
      <div class="connections-heading">
        <PageHeading title="User" />
      </div>
      <Show when={access()?.role === 'admin'}>
        <WorkforceProfile userId={params.userId} showTitle />
      </Show>
    </section>
  );
}
