import Breadcrumbs from '../../components/Breadcrumbs.jsx';
import KnowledgePermissions from '../../components/KnowledgePermissions.jsx';
import ToastMessage from '../../components/ToastMessage.jsx';
import ValidatedForm from '../../components/ValidatedForm.jsx';
import { Show, createSignal } from 'solid-js';
import { useNavigate, useSearchParams } from '@solidjs/router';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useSession } from '../../context/SessionContext.jsx';
import { useWorkspacePath } from '../../services/workspaceRoutes.js';
import { api } from '../../services/api.js';
import A from '../../components/WorkspaceLink.jsx';
import PageHeading from '../../components/PageHeading.jsx';
import MultiSelectLookup from '../../components/MultiSelectLookup.jsx';

export default function CreateTopicPage(props) {
  const { session } = useSession();
  const { workspace, refresh } = useWorkspace();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const baseId = () => props.topic?.knowledgeBaseId || params.base || '';
  const path = useWorkspacePath();
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/topics${props.topic ? '/' + props.topic.id : ''}`, {
        method: props.topic ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          description: form.get('description'),
          articleIds: form.getAll('article'),
          ...(baseId() ? { knowledgeBaseId: baseId() } : {}),
        }),
      });
      await refresh();
      navigate(
        path(
          baseId() ? `/workspace/knowledge/bases/${baseId()}` : '/workspace/knowledge?tab=topics',
        ),
      );
    } catch (error) {
      setError(error.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section class="reading-page">
      <Breadcrumbs
        label="Topic location"
        items={[
          { label: 'Knowledge', href: '/workspace/knowledge?tab=topics' },
          baseId() && {
            label:
              workspace()?.knowledgeBases?.find((item) => item.id === baseId())?.name ||
              'Knowledge Base',
            href: `/workspace/knowledge/bases/${encodeURIComponent(baseId())}`,
          },
          { label: props.topic?.name || 'New Topic' },
        ]}
      />
      <Show when={props.topic?.id}>
        <KnowledgePermissions kind="topic" id={props.topic.id} />
      </Show>
      <PageHeading title={props.topic ? 'Edit topic' : 'New topic'} />
      <Show
        when={session()?.user && !session().user.isDemo}
        fallback={
          <p>
            <A href="/login">Sign in</A> with a registered account to create topics.
          </p>
        }
      >
        <ValidatedForm class="create-form" onSubmit={save}>
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
          <MultiSelectLookup
            label="Articles"
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
          <small>
            Topics organize articles. They never grant access to another knowledge base.
          </small>
          <Show when={error()}>
            <ToastMessage tone="error">{error()}</ToastMessage>
          </Show>
          <button class="workspace-button" disabled={saving()}>
            {saving() ? 'Saving…' : 'Save'}
          </button>
        </ValidatedForm>
      </Show>
    </section>
  );
}
