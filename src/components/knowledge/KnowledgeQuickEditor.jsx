import Icon from '../Icon.jsx';
import { Dynamic } from 'solid-js/web';
import KnowledgeEditorPanel from './KnowledgeEditorPanel.jsx';
import { Show, createResource, createEffect, createSignal } from 'solid-js';
import WorkspaceModal from '../WorkspaceModal.jsx';
import RecordForm from '../records/RecordForm.jsx';
import KnowledgePermissions from './KnowledgePermissions.jsx';
import Skeleton from '../Skeleton.jsx';
import ToastMessage from '../ToastMessage.jsx';
import { api } from '../../services/api.js';
import { confirmAction } from '../../services/confirmations.js';
import { useToasts } from '../../context/ToastContext.jsx';

export default function KnowledgeQuickEditor(props) {
  const { notify } = useToasts();
  const type = props.kind === 'base' ? 'knowledge-base' : 'topic';
  const noun = props.kind === 'base' ? 'Knowledge Base' : 'Topic';
  const [record] = createResource(
    () => props.record?.id,
    (id) => api(`/api/records/${type}/${id}`),
  );
  const [values, setValues] = createSignal({
    name: props.record?.name || '',
    description: props.record?.description || '',
  });
  const [savedId, setSavedId] = createSignal(props.record?.id || '');
  const [dirty, setDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const [permissions, setPermissions] = createSignal();
  createEffect(() => {
    if (record() && !dirty())
      setValues({ name: record().name, description: record().description || '' });
  });
  async function beforeClose() {
    if (saving()) return false;
    if (
      dirty() &&
      !(await confirmAction('Discard your unsaved changes?', 'Discard Changes', 'Discard'))
    )
      return false;
    window.dispatchEvent(new Event('agentzuno-form-saved'));
    return true;
  }
  props.controller?.({ beforeClose });
  async function save(event) {
    event.preventDefault();
    if (saving() || record.loading || record.error || !permissions()?.ready) return;
    setSaving(true);
    setError('');
    try {
      const body = {
        ...values(),
        ...(props.kind === 'topic'
          ? {
              ...(!props.record
                ? { articleIds: [], parentTopicId: props.parentTopicId || '' }
                : {}),
              ...(record()?.knowledgeBaseId || props.baseId
                ? { knowledgeBaseId: record()?.knowledgeBaseId || props.baseId }
                : {}),
            }
          : {}),
      };
      const saved = await api(
        props.kind === 'base'
          ? `/api/records/knowledge-base${savedId() ? '/' + savedId() : ''}`
          : `/api/topics${savedId() ? '/' + savedId() : ''}`,
        { method: savedId() ? 'PATCH' : 'POST', deferSavedEvent: true, body: JSON.stringify(body) },
      );
      setSavedId(saved.id);
      await permissions().save(saved.id);
      setDirty(false);
      window.dispatchEvent(new Event('agentzuno-form-saved'));
      await props.onSaved?.(saved);
      notify({ tone: 'success', message: `${noun} saved.` });
      props.onClose();
    } catch (error) {
      setError(error.message);
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    if (saving() || !record() || record().isDefault) return;
    const name = record().name;
    if (
      !(await confirmAction(
        `Delete “${name}”? Move any articles and subtopics first.`,
        `Delete ${noun}`,
        'Delete',
        { requiredText: name },
      ))
    )
      return;
    setSaving(true);
    setError('');
    try {
      await api(`/api/helpdesk/knowledge-folders/${props.kind}/${savedId()}/delete`, {
        method: 'POST',
        body: JSON.stringify({ confirmed: true, name }),
        deferSavedEvent: true,
      });
      setDirty(false);
      window.dispatchEvent(new Event('agentzuno-form-saved'));
      await props.onDeleted?.();
      notify({ tone: 'success', message: `${noun} deleted.` });
      props.onClose();
    } catch (error) {
      setError(error.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dynamic
      component={props.record ? KnowledgeEditorPanel : WorkspaceModal}
      title={`${props.record ? 'Edit' : 'Add'} ${noun}`}
      onClose={props.onClose}
      beforeClose={beforeClose}
    >
      <Show
        when={!record.loading}
        fallback={<Skeleton label="Loading knowledge settings" lines={4} />}
      >
        <Show when={record.error || error()}>
          <ToastMessage tone="error">{record.error?.message || error()}</ToastMessage>
        </Show>
        <RecordForm
          sections={[
            {
              fields: [
                {
                  id: 'name',
                  label: 'Name',
                  type: 'text',
                  required: true,
                  maxLength: props.kind === 'topic' ? 100 : 160,
                },
                {
                  id: 'description',
                  label: 'Description',
                  type: 'textarea',
                  maxLength: props.kind === 'topic' ? 1000 : 20000,
                  rows: 4,
                },
              ],
            },
          ]}
          values={values()}
          disabled={saving() || !!record.error || !permissions()?.ready}
          onChange={(key, value) => {
            setDirty(true);
            setValues((previous) => ({ ...previous, [key]: value }));
          }}
          onSubmit={save}
        >
          <section class="record-section">
            <h2>Permissions</h2>
            <KnowledgePermissions
              kind={props.kind}
              id={props.record?.id}
              embedded
              disabled={saving()}
              onChange={() => setDirty(true)}
              controller={setPermissions}
            />
          </section>
          <div class="helpdesk-actions">
            <button
              class="workspace-button"
              disabled={saving() || !!record.error || !permissions()?.ready}
            >
              <Icon name="save" />

              {saving() ? 'Saving…' : 'Save'}
            </button>
            <Show when={props.record && record() && !record().isDefault}>
              <button
                type="button"
                class="workspace-button secondary"
                disabled={saving()}
                onClick={remove}
              >
                Delete
              </button>
            </Show>
            <button
              type="button"
              class="workspace-button secondary"
              disabled={saving()}
              onClick={async () => {
                if (await beforeClose()) props.onClose();
              }}
            >
              Cancel
            </button>
          </div>
        </RecordForm>
      </Show>
    </Dynamic>
  );
}
