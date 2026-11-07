import { isOperationalField } from '../../../utils/recordFields.js';
import Icon from '../../../components/Icon.jsx';
import TooltipRegion from '../../../components/TooltipRegion.jsx';
import DataRecordDeletion from '../../../components/data/DataRecordDeletion.jsx';
import RecordActivity from '../../../components/records/RecordActivity.jsx';
import Breadcrumbs from '../../../components/Breadcrumbs.jsx';
import Skeleton from '../../../components/Skeleton.jsx';
import { Show, createEffect, createResource, createSignal } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import { api } from '../../../services/api.js';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { useWorkspacePath } from '../../../services/workspaceRoutes.js';
import { useToasts } from '../../../context/ToastContext.jsx';
import RecordForm from '../../../components/records/RecordForm.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
import A from '../../../components/WorkspaceLink.jsx';
import SplitResizeHandle from '../../../components/SplitResizeHandle.jsx';
import { useSession } from '../../../context/SessionContext.jsx';
export default function DataRecordPage() {
  const params = useParams();
  const navigate = useNavigate();
  const path = useWorkspacePath();
  const { access } = useWorkspace();
  const { session } = useSession();
  let selectPanel;
  let validateContent, validateProperties, showProperties;
  const contentFields = () => (table()?.fields || []).filter((field) => !isOperationalField(field));
  const propertyFields = () => (table()?.fields || []).filter(isOperationalField);
  const { notify } = useToasts();
  const isAdmin = () => !access.error && access()?.role === 'admin';
  const isNew = () => params.recordId === 'new';
  const [table] = createResource(
    () => isAdmin() && params.id,
    (id) => api(`/api/helpdesk/data/tables/${id}`),
  );
  const [record, { refetch }] = createResource(
    () => isAdmin() && !isNew() && `${params.id}/records/${params.recordId}`,
    (id) => api(`/api/helpdesk/data/tables/${id}`),
  );
  createEffect(() => {
    if (params.id === 'ref-task')
      navigate(path(`/workspace/tasks/${params.recordId}`), { replace: true });
  });
  const relatedFields = () =>
    (!record.error &&
      table()?.fields.filter((field) => {
        if (field.type !== 'reference') return false;
        const value = record()?.values?.[field.id];
        return Array.isArray(value)
          ? value.length > 0
          : typeof value === 'string' && !!value.trim();
      })) ||
    [];
  const [values, setValues] = createSignal({});
  const [saving, setSaving] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const isEditing = () => isNew() || (editing() && !table()?.sourceManaged);
  const recordTitle = () => {
    const saved = !record.error && record()?.values;
    const keys = ['name', 'title', 'number', 'assetTag', 'hostname', 'code'];
    const value = keys
      .map((key) => saved?.[key])
      .find((value) => typeof value === 'string' && value.trim());
    return value?.trim().slice(0, 160) || (!table.error && table()?.name) || 'Record';
  };
  createEffect(() => {
    if (!record.error && record()) setValues({ ...record().values });
    else if (isNew()) setValues({});
  });
  async function save(event) {
    event.preventDefault();
    if (validateContent && !validateContent()) {
      selectPanel?.('left');
      return;
    }
    if (propertyFields().length && validateProperties && !validateProperties()) {
      showProperties?.();
      selectPanel?.('right');
      queueMicrotask(() => validateProperties());
      return;
    }
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
      notify({
        tone: 'success',
        message: 'Record saved.',
        destination: isNew() ? path(`/workspace/data/${params.id}`) : undefined,
      });
      if (isNew()) navigate(path(`/workspace/data/${params.id}`));
      else {
        setEditing(false);
        await refetch();
      }
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setSaving(false);
    }
  }
  return (
    <section class="reading-page data-record-page data-record-workspace">
      <Show
        when={isAdmin()}
        fallback={
          <Show when={!access.loading && !!access()}>
            <ToastMessage tone="error">Administrator access is required.</ToastMessage>
          </Show>
        }
      >
        <div class="data-record-topbar">
          <Breadcrumbs
            items={[
              { label: 'Data Tables', href: '/workspace/data' },
              {
                label: (!table.error && table()?.name) || 'Data Table',
                href: `/workspace/data/${params.id}`,
              },
              { label: isNew() ? 'Add Record' : recordTitle() },
            ]}
          />
          <h1 class="sr-only">{isNew() ? 'Add Record' : recordTitle()}</h1>
          <div class="helpdesk-actions">
            <Show when={!isNew() && !record.error && record()?.sourceHref}>
              <A
                class="workspace-button secondary small"
                href={record().sourceHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Original Record →
              </A>
            </Show>
            <Show when={isEditing()}>
              <div class="helpdesk-actions">
                <button
                  type="submit"
                  form="data-record-form"
                  class="workspace-button"
                  disabled={saving() || table.loading}
                >
                  <Icon name="save" />

                  {saving() ? 'Saving…' : 'Save Record'}
                </button>
                <Show
                  when={!isNew()}
                  fallback={
                    <A class="workspace-button secondary" href={`/workspace/data/${params.id}`}>
                      Cancel
                    </A>
                  }
                >
                  <button
                    type="button"
                    class="workspace-button secondary"
                    disabled={saving()}
                    onClick={() => {
                      setValues({ ...record().values });
                      setEditing(false);
                    }}
                  >
                    Cancel
                  </button>
                </Show>
              </div>
            </Show>
            <Show when={!isEditing() && !record.error && record()}>
              <TooltipRegion>
                <span
                  class="source-record-edit"
                  tabindex={table()?.sourceManaged ? 0 : undefined}
                  aria-label={table()?.sourceManaged ? 'Why editing is unavailable' : undefined}
                  data-tooltip={table()?.sourceManaged ? 'Edit on the original record.' : undefined}
                >
                  <button
                    type="button"
                    class="workspace-button secondary small"
                    disabled={!!table()?.sourceManaged}
                    onClick={() => {
                      setEditing(true);
                      selectPanel?.('left');
                    }}
                  >
                    Edit
                  </button>
                </span>
              </TooltipRegion>
            </Show>
            <Show
              when={
                !isNew() &&
                !isEditing() &&
                !table.error &&
                table() &&
                !table().sourceManaged &&
                !record.error &&
                record()
              }
            >
              <DataRecordDeletion
                tableId={params.id}
                recordId={params.recordId}
                version={record().version}
              />
            </Show>
          </div>
        </div>
        <Show when={table.error || record.error}>
          <ToastMessage tone="error">{table.error?.message || record.error?.message}</ToastMessage>
        </Show>
        <div class="data-record-workbench resizable-split">
          <section class="data-record-properties" aria-label="Record properties">
            <div class="data-record-properties-scroll">
              <Show when={table.loading || (!isNew() && record.loading)}>
                <Skeleton label="Loading record fields" lines={8} />
              </Show>
              <Show when={!table.error && table() && (isNew() || (!record.error && record()))}>
                <RecordForm
                  id="data-record-form"
                  validationRef={(validate) => {
                    validateContent = validate;
                  }}
                  showDescriptionBlocks={false}
                  fields={contentFields()}
                  values={values()}
                  detailsOnly={!isEditing()}
                  readOnly={!isEditing()}
                  readOnlyFields={table().readOnlyFields}
                  includeDemo={Boolean(record()?.demoDatasetId)}
                  onChange={(key, value) =>
                    setValues((previous) => ({ ...previous, [key]: value }))
                  }
                  onSubmit={save}
                />
              </Show>
            </div>
          </section>
          <SplitResizeHandle
            storageKey={`data-record-form-activity-${session()?.user?.id}-${params.workspaceId}`}
            initialRatio={62}
            minRightWidth={320}
            maxRightWidth={640}
            initialPanel="left"
            leftLabel="Form"
            rightLabel="Activity"
            ariaLabel="Resize record panels"
            switcherLabel="Record view"
            onPanelReady={(select) => {
              selectPanel = select;
            }}
          />
          <aside class="data-record-timeline" aria-label="Record activity">
            <RecordActivity
              kind="data"
              recordId={params.recordId}
              tableId={params.id}
              isNew={isNew()}
              onPropertiesReady={(show) => {
                showProperties = show;
              }}
              propertiesContent={() => (
                <Show when={!table.error && table() && (isNew() || (!record.error && record()))}>
                  <Show
                    when={propertyFields().length}
                    fallback={<p class="field-help">No additional properties.</p>}
                  >
                    <RecordForm
                      id="data-record-properties-form"
                      validationRef={(validate) => {
                        validateProperties = validate;
                      }}
                      fields={propertyFields()}
                      values={values()}
                      detailsOnly={!isEditing()}
                      readOnly={!isEditing()}
                      readOnlyFields={table().readOnlyFields}
                      includeDemo={Boolean(record()?.demoDatasetId)}
                      onChange={(key, value) =>
                        setValues((previous) => ({ ...previous, [key]: value }))
                      }
                      onSubmit={save}
                    />
                  </Show>
                </Show>
              )}
              relatedContent={() => (
                <Show
                  when={relatedFields().length}
                  fallback={
                    <p class="field-help">
                      {isNew()
                        ? 'Save this record to see related records.'
                        : 'No related records linked.'}
                    </p>
                  }
                >
                  <RecordForm
                    fields={relatedFields()}
                    values={record()?.values || {}}
                    detailsOnly
                    readOnly
                    includeDemo={Boolean(record()?.demoDatasetId)}
                  />
                </Show>
              )}
            />
          </aside>
        </div>
      </Show>
    </section>
  );
}
