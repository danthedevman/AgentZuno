import Icon from '../../../components/Icon.jsx';
import { createResource, createSignal, Show } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import { api } from '../../../services/api.js';
import { useWorkspacePath } from '../../../services/workspaceRoutes.js';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { useToasts } from '../../../context/ToastContext.jsx';
import { confirmAction } from '../../../services/confirmations.js';
import PageHeading from '../../../components/PageHeading.jsx';
import RecordTable from '../../../components/records/RecordTable.jsx';
import A from '../../../components/WorkspaceLink.jsx';
import Skeleton from '../../../components/Skeleton.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
export default function UserAccessPage() {
  const params = useParams(),
    navigate = useNavigate(),
    path = useWorkspacePath();
  const { access } = useWorkspace(),
    { notify } = useToasts();
  const [busy, setBusy] = createSignal(false);
  const [record, { refetch }] = createResource(
    () => params.id,
    (id) => api(`/api/helpdesk/user-access/${id}`),
  );
  const current = () => (record.error ? null : record());
  async function change(status) {
    if (
      !(await confirmAction(
        status === 'active'
          ? 'Confirm this access has actually been provisioned? This records fulfillment and does not provision access in the external application.'
          : status === 'revoked'
            ? 'Confirm this access has actually been removed from the external application?'
            : 'Mark this access request as failed? This allows the person to request it again.',
        'Confirm Access Update',
        'Confirm',
      ))
    )
      return;
    setBusy(true);
    try {
      await api(`/api/helpdesk/user-access/${params.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, version: current().version, confirmed: true }),
      });
      await refetch();
      notify({ tone: 'success', message: 'Access record updated.' });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section class="reading-page">
      <PageHeading
        title={params.id ? current()?.applicationName || 'User Access' : 'User Access'}
      />
      <Show
        when={params.id}
        fallback={
          <RecordTable
            label="User Access"
            source="/api/helpdesk/user-access"
            columns={[
              { label: 'Application', render: (item) => item.applicationName },
              { label: 'User', render: (item) => item.userName },
              { label: 'Access', render: (item) => item.accessLevel },
              { label: 'Status', render: (item) => item.status },
            ]}
            onRowClick={(item) => navigate(path(`/workspace/access/${item.id}`))}
          />
        }
      >
        <Show when={record.loading}>
          <Skeleton label="Loading access record" lines={5} />
        </Show>
        <Show when={record.error}>
          <ToastMessage tone="error">{record.error.message}</ToastMessage>
        </Show>
        <Show when={current()}>
          {(item) => (
            <>
              <dl class="record-property-list">
                <div>
                  <dt>User</dt>
                  <dd>{item().userName}</dd>
                </div>
                <div>
                  <dt>Application</dt>
                  <dd>{item().applicationName}</dd>
                </div>
                <div>
                  <dt>Access Level</dt>
                  <dd>{item().accessLevel}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{item().status}</dd>
                </div>
                <div>
                  <dt>Request</dt>
                  <dd>
                    <Show when={item().requestId} fallback="Submission pending">
                      <A href={`/workspace/requests/${item().requestId}`}>{item().requestNumber}</A>
                    </Show>
                  </dd>
                </div>
              </dl>
              <Show when={['admin', 'agent'].includes(access()?.role)}>
                <div class="helpdesk-actions">
                  <Show when={['requested', 'provisioning'].includes(item().status)}>
                    <button
                      class="workspace-button"
                      disabled={busy()}
                      onClick={() => change('active')}
                    >
                      <Icon name="check" />
                      Confirm Provisioned
                    </button>
                    <button
                      class="workspace-button secondary"
                      disabled={busy()}
                      onClick={() => change('failed')}
                    >
                      Mark Failed
                    </button>
                  </Show>
                  <Show when={item().status === 'active'}>
                    <button
                      class="workspace-button secondary"
                      disabled={busy()}
                      onClick={() => change('revoked')}
                    >
                      Confirm Revoked
                    </button>
                  </Show>
                </div>
              </Show>
            </>
          )}
        </Show>
      </Show>
    </section>
  );
}
