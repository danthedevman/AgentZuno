import Icon from '../../../components/Icon.jsx';
import { useToasts } from '../../../context/ToastContext.jsx';
import Breadcrumbs from '../../../components/Breadcrumbs.jsx';
import KnowledgePermissions from '../../../components/knowledge/KnowledgePermissions.jsx';
import ToastMessage from '../../../components/ToastMessage.jsx';
import ValidatedForm from '../../../components/ValidatedForm.jsx';
import { Show, createSignal } from 'solid-js';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { useWorkspace } from '../../../context/WorkspaceContext.jsx';
import { useSession } from '../../../context/SessionContext.jsx';
import { useWorkspacePath } from '../../../services/workspaceRoutes.js';
import { api } from '../../../services/api.js';
import A from '../../../components/WorkspaceLink.jsx';
import RecordHeader from '../../../components/records/RecordHeader.jsx';
import RecordValue from '../../../components/records/RecordValue.jsx';
import MultiSelectLookup from '../../../components/MultiSelectLookup.jsx';

export default function CreateTopicPage(props) {
  const { notify } = useToasts();
  const { session } = useSession();
  const { workspace, refresh } = useWorkspace();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const baseId = () => props.topic?.knowledgeBaseId || params.base || '';
  const path = useWorkspacePath();
  const [editing, setEditing] = createSignal(!props.topic);
  const [savedId, setSavedId] = createSignal(props.topic?.id || '');
  let permissions;
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  async function save(event) {
    event.preventDefault();
    if (!editing()) return;
    setSaving(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await api(`/api/topics${savedId() ? '/' + savedId() : ''}`, {
        method: savedId() ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          description: form.get('description'),
          articleIds: form.getAll('article'),
          ...(baseId() ? { knowledgeBaseId: baseId() } : {}),
        }),
      });
      try {
        if (permissions) await permissions.save(result.id);
      } finally {
        setSavedId(result.id);
      }
      await refresh();
      const destination = path(
        baseId() ? `/workspace/knowledge/bases/${baseId()}` : '/workspace/knowledge',
      );
      notify({ tone: 'success', message: 'Topic saved.', destination });
      navigate(path(baseId() ? `/workspace/knowledge/bases/${baseId()}` : '/workspace/knowledge'));
    } catch (error) {
      setError(error.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section class="reading-page record-form-page">
      <Breadcrumbs
        label="Topic location"
        items={[
          { label: 'Knowledge', href: '/workspace/knowledge' },
          baseId() && {
            label:
              workspace()?.knowledgeBases?.find((item) => item.id === baseId())?.name ||
              'Knowledge Base',
            href: `/workspace/knowledge/bases/${encodeURIComponent(baseId())}`,
          },
          { label: props.topic?.name || 'New Topic' },
        ]}
      />
      <RecordHeader title={props.topic?.name || 'New Topic'}>
        <Show
          when={editing()}
          fallback={
            <button class="workspace-button small" onClick={() => setEditing(true)}>
              <Icon name="edit" />
              Edit Topic
            </button>
          }
        >
          <A
            class="workspace-button secondary small"
            href={baseId() ? `/workspace/knowledge/bases/${baseId()}` : '/workspace/knowledge'}
          >
            Cancel
          </A>
          <button
            type="submit"
            form="topic-record-form"
            class="workspace-button small"
            disabled={saving()}
          >
            <Icon name="save" />

            {saving() ? 'Saving…' : 'Save Topic'}
          </button>
        </Show>
      </RecordHeader>
      <Show
        when={session()?.user && !session().user.isDemo}
        fallback={
          <p>
            <A href="/login">Sign in</A> with a registered account to create topics.
          </p>
        }
      >
        <ValidatedForm
          id="topic-record-form"
          class="create-form record-surface record-property-sheet"
          onSubmit={save}
        >
          <section class="record-section">
            <div class="record-property-list">
              <Show
                when={editing()}
                fallback={
                  <>
                    <RecordValue label="Name" value={props.topic?.name} />
                    <RecordValue label="Description" value={props.topic?.description} />
                  </>
                }
              >
                <label>
                  Name
                  <input name="name" required maxlength="100" value={props.topic?.name || ''} />
                </label>
                <label>
                  Description
                  <textarea
                    name="description"
                    rows="3"
                    maxlength="1000"
                    value={props.topic?.description || ''}
                  />
                </label>
              </Show>
              <MultiSelectLookup
                label="Articles"
                readOnly={!editing()}
                referenceTable="ref-article"
                name="article"
                defaultValue={
                  props.topic
                    ? (workspace()?.articles || [])
                        .filter((article) =>
                          Array.isArray(article.topicIds)
                            ? article.topicIds.includes(props.topic.id)
                            : props.topic.articleIds?.includes(article.id),
                        )
                        .map((article) => article.id)
                    : []
                }
                options={(workspace()?.articles || [])
                  .filter((article) => !baseId() || article.base === baseId())
                  .map((article) => ({
                    value: article.id,
                    href: `/workspace/articles/${article.id}`,
                    label: article.title,
                  }))}
              />
            </div>
            <small>
              Topics organize articles. They never grant access to another knowledge base.
            </small>
          </section>
          <section class="record-section">
            <h2>Permissions</h2>
            <KnowledgePermissions
              kind="topic"
              id={savedId()}
              embedded
              disabled={!editing() || saving()}
              readOnly={!editing()}
              controller={(controller) => {
                permissions = controller;
              }}
            />
          </section>
          <Show when={error()}>
            <ToastMessage tone="error">{error()}</ToastMessage>
          </Show>
        </ValidatedForm>
      </Show>
    </section>
  );
}
