import BackLink from '../../components/BackLink.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import { For, Show, createEffect, createResource, createSignal } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import { api } from '../../services/api.js';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
import { useToasts } from '../../context/ToastContext.jsx';
import PageHeading from '../../components/PageHeading.jsx';
import ValidatedForm from '../../components/ValidatedForm.jsx';
import DataRecordField from '../../components/DataRecordField.jsx';
import ToastMessage from '../../components/ToastMessage.jsx';
import A from '../../components/WorkspaceLink.jsx';
import RecordTable from '../../components/RecordTable.jsx';
export default function DataRecordPage() {
  const params = useParams();
  const navigate = useNavigate();
  const path = useWorkspacePath();
  const { access } = useWorkspace();
  const { notify } = useToasts();
  const isAdmin = () => !access.error && access()?.role === 'admin';
  const isNew = () => params.recordId === 'new';
  const [table] = createResource(
    () => isAdmin() && params.id,
    (id) => api(`/api/helpdesk/data/tables/${id}`),
  );
  const [record] = createResource(
    () => isAdmin() && !isNew() && `${params.id}/records/${params.recordId}`,
    (id) => api(`/api/helpdesk/data/tables/${id}`),
  );
  createEffect(() => {
    if (params.id === 'ref-task')
      navigate(path(`/workspace/tasks/${params.recordId}`), { replace: true });
  });
  const [values, setValues] = createSignal({});
  const [saving, setSaving] = createSignal(false);
  createEffect(() => {
    if (!record.error && record()) setValues({ ...record().values });
    else if (isNew()) setValues({});
  });
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      await api(
        `/api/helpdesk/data/tables/${params.id}/records${isNew() ? '' : `/${params.recordId}`}`,
        {
          method: isNew() ? 'POST' : 'PUT',
          body: JSON.stringify({
            values: Object.fromEntries(
              table().fields.map((field) => [
                field.id,
                values()[field.id] ?? (field.type === 'boolean' ? false : ''),
              ]),
            ),
            ...(isNew() ? {} : { version: record().version }),
          }),
        },
      );
      notify({ tone: 'success', message: 'Record saved.' });
      navigate(path(`/workspace/data/${params.id}`));
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setSaving(false);
    }
  }
  return (
    <section class="reading-page data-record-page">
      <Show
        when={isAdmin()}
        fallback={
          <Show when={!access.loading && !!access()}>
            <ToastMessage tone="error">Administrator access is required.</ToastMessage>
          </Show>
        }
      >
        <BackLink href={`/workspace/data/${params.id}`}>
          {(!table.error && table()?.name) || 'Data Table'}
        </BackLink>
        <div class="connections-heading">
          <PageHeading title={isNew() ? 'Add Record' : 'Edit Record'} />
        </div>
        <Show when={table.error || record.error}>
          <ToastMessage tone="error">{table.error?.message || record.error?.message}</ToastMessage>
        </Show>
        <Show when={table.loading || (!isNew() && record.loading)}>
          <div class="data-record-loading" aria-label="Loading record fields" aria-busy="true">
            <Skeleton label="Loading table name" lines={1} />
            <div class="data-record-fields">
              <For each={Array.from({ length: 8 })}>
                {() => (
                  <div class="data-field-skeleton">
                    <Skeleton label="Loading field label" lines={1} />
                    <Skeleton label="Loading field" lines={1} />
                  </div>
                )}
              </For>
            </div>
            <div class="helpdesk-actions">
              <Skeleton label="Loading actions" lines={1} />
            </div>
          </div>
        </Show>
        <Show when={!table.error && table() && (isNew() || (!record.error && record()))}>
          <h2>{table().name}</h2>
          <Show when={record()?.sourceHref}>
            <A
              class="workspace-button secondary small"
              href={record().sourceHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Original Record →
            </A>
          </Show>
          <ValidatedForm class="create-form" onSubmit={save}>
            <div class="data-record-fields">
              <For each={table().fields}>
                {(field) => (
                  <DataRecordField
                    includeDemo={Boolean(record()?.demoDatasetId)}
                    readOnly={table().readOnlyFields?.includes(field.id)}
                    field={field}
                    value={values()[field.id]}
                    onChange={(value) =>
                      setValues((previous) => ({ ...previous, [field.id]: value }))
                    }
                  />
                )}
              </For>
            </div>
            <div class="helpdesk-actions">
              <button class="workspace-button" disabled={saving()}>
                {saving() ? 'Saving…' : 'Save Record'}
              </button>
              <A class="workspace-button secondary" href={`/workspace/data/${params.id}`}>
                Cancel
              </A>
            </div>
          </ValidatedForm>
          <Show when={!isNew() && params.id === 'ref-catalog-category'}>
            <section class="category-related-workflows">
              <h2>Related Workflows</h2>
              <RecordTable
                label="Related Workflows"
                source={`/api/helpdesk/data/tables/ref-catalog-category/records/${params.recordId}/workflows`}
                emptyText="No workflows use this category"
                emptyAction={{ label: 'New Workflow', href: '/workspace/workflows/new' }}
                columns={[
                  {
                    label: 'Workflow',
                    render: (item) => (
                      <A href={`/workspace/workflows/${item.id}/edit`}>{item.name}</A>
                    ),
                  },
                  { label: 'Status', render: (item) => item.status },
                  { label: 'Updated', render: (item) => new Date(item.updatedAt).toLocaleString() },
                ]}
              />
            </section>
          </Show>
        </Show>
      </Show>
    </section>
  );
}
