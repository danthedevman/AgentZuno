import { createSignal, Show } from 'solid-js';
import RecordTable from '../records/RecordTable.jsx';
import CodeBlock from '../CodeBlock.jsx';
import { api } from '../../services/api.js';
import { confirmAction } from '../../services/confirmations.js';
import { useToasts } from '../../context/ToastContext.jsx';
export default function WorkflowVersions(props) {
  const { notify } = useToasts();
  const [preview, setPreview] = createSignal(null);
  const [busy, setBusy] = createSignal(false);
  const [revision, setRevision] = createSignal(0);
  async function inspect(item) {
    setBusy(true);
    try {
      setPreview(
        await api(`/api/helpdesk/workflows/${props.workflow.id}/versions/${item.version}`),
      );
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  async function restore(item) {
    if (
      !(await confirmAction(
        `Restore version ${item.version} as a new draft? Current draft changes will be replaced. The published workflow will remain unchanged.`,
        'Restore Workflow Version',
        'Restore as Draft',
      ))
    )
      return;
    setBusy(true);
    try {
      const result = await api(
        `/api/helpdesk/workflows/${props.workflow.id}/versions/${item.version}/restore`,
        {
          method: 'POST',
          body: JSON.stringify({ confirmed: true, version: props.workflow.version }),
        },
      );
      await props.onRestored(result);
      setPreview(null);
      setRevision((value) => value + 1);
      notify({
        tone: 'success',
        message: `Version ${item.version} restored as a new draft. Publish it when ready.`,
      });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Workflow versions">
      <p>
        Preview saved versions or restore one as a new draft. Publishing remains a separate action.
      </p>
      <RecordTable
        label="Workflow Versions"
        source={`/api/helpdesk/workflows/${props.workflow.id}/versions`}
        refreshKey={revision()}
        defaultSort={{ key: 'Version', direction: 'desc' }}
        columns={[
          { label: 'Version', render: (item) => `Version ${item.version}` },
          {
            label: 'Saved',
            render: (item) => (item.savedAt ? new Date(item.savedAt).toLocaleString() : '—'),
          },
          {
            label: 'State',
            sortable: false,
            render: (item) =>
              item.published
                ? 'Published'
                : item.current
                  ? 'Current Draft'
                  : item.publishedAtSave
                    ? 'Previously Published'
                    : 'Draft',
          },
          {
            label: 'Actions',
            sortable: false,
            render: (item) => (
              <div class="helpdesk-actions">
                <button
                  class="workspace-button secondary small"
                  disabled={busy() || props.busy}
                  onClick={() => inspect(item)}
                >
                  Preview Version {item.version}
                </button>
                <Show when={!item.current}>
                  <button
                    class="workspace-button secondary small"
                    disabled={busy() || props.busy}
                    onClick={() => restore(item)}
                  >
                    Restore as Draft
                  </button>
                </Show>
              </div>
            ),
          },
        ]}
      />
      <Show when={preview()}>
        {(item) => (
          <section aria-label={`Version ${item().version} preview`}>
            <h3>
              Version {item().version}: {item().config.name}
            </h3>
            <CodeBlock code={item().config.source || ''} language="typescript" />
          </section>
        )}
      </Show>
    </section>
  );
}
