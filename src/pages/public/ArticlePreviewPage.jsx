import { Show, createEffect, createResource } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import { useSession } from '../../context/SessionContext.jsx';
import { api } from '../../services/api.js';
import ArticleEditor from '../../components/knowledge/ArticleEditor.jsx';
import ProfileAvatar from '../../components/identity/ProfileAvatar.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import ToastMessage from '../../components/ToastMessage.jsx';
export default function ArticlePreviewPage() {
  const params = useParams();
  const theme = localStorage.getItem('agentzuno-theme') || 'dark';
  const { session } = useSession();
  const navigate = useNavigate();
  createEffect(() => {
    if (!session.loading && !session()?.user) navigate('/login');
  });
  const [preview] = createResource(
    () => session()?.user && (params.articleId || params.id),
    (id) =>
      api(params.articleId ? `/api/articles/${id}` : `/api/helpdesk/article-proposals/${id}`, {
        headers: { 'X-Workspace-Id': params.workspaceId },
      }),
  );
  return (
    <div class="workspace-shell article-standalone" data-theme={theme}>
      <header class="article-standalone-header">
        <a class="article-brand" href={`/workspace/${params.workspaceId}/knowledge`}>
          <img
            src={theme === 'light' ? '/agentzuno-wordmark-light.svg' : '/agentzuno-wordmark.svg'}
            alt="AgentZuno"
            width="130"
            height="33"
          />
        </a>
        <a aria-label="Your profile" href={`/workspace/${params.workspaceId}/profile`}>
          <ProfileAvatar userId={session()?.user?.id} name={session()?.user?.name} />
        </a>
      </header>
      <main class="article-standalone-content">
        <Show when={preview.error}>
          <ToastMessage tone="error">{preview.error.message}</ToastMessage>
        </Show>
        <Show when={preview()} fallback={<Skeleton label="Loading article preview" lines={6} />}>
          {(value) => (
            <article>
              <h1>{(value().draft || value()).title}</h1>
              <ArticleEditor readOnly content={(value().draft || value()).body} />
            </article>
          )}
        </Show>
      </main>
    </div>
  );
}
