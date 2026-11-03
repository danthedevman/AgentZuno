import Skeleton from '../../components/Skeleton.jsx';
import A from '../../components/WorkspaceLink.jsx';
import { useLocation, useParams } from '@solidjs/router';
import { Show } from 'solid-js';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';

export default function ContentPage() {
  const { workspace } = useWorkspace();
  const params = useParams();
  const location = useLocation();
  const isImage = () => location.pathname.includes('/images/');
  const item = () =>
    workspace()?.[isImage() ? 'images' : 'files']?.find((item) => item.id === params.id);

  return (
    <>
      <Show
        when={item()}
        fallback={
          <Show
            when={workspace.sectionLoaded(isImage() ? 'images' : 'files')}
            fallback={<Skeleton label="Loading content" lines={7} />}
          >
            <div class="empty-state">
              <h1>Content unavailable</h1>
              <p>This item is not part of your current workspace.</p>
            </div>
          </Show>
        }
      >
        {(content) => (
          <article class="reading-page">
            <div class="card-meta">
              {content().downloadUrl ? 'Saved' : 'Mock'} {isImage() ? 'image' : 'file'}
            </div>
            <h1>{content().title}</h1>
            <p class="article-summary">{content().summary}</p>
            <Show when={content().uploadId}>
              <A
                class="workspace-button small"
                href={`/workspace/records/file/${content().id}/edit`}
              >
                Edit file
              </A>
            </Show>
            <Show
              when={isImage()}
              fallback={
                <Show
                  when={content().downloadUrl}
                  fallback={<pre class="file-preview">{content().content}</pre>}
                >
                  <a class="workspace-button" href={content().downloadUrl} download>
                    Download file
                  </a>
                </Show>
              }
            >
              <img class="image-preview" src={content().src} alt={content().alt} />
            </Show>
          </article>
        )}
      </Show>
    </>
  );
}
