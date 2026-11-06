import { Show, createSignal } from 'solid-js';
import ArticleEditor from './ArticleEditor.jsx';
import ArticleAttachments from './ArticleAttachments.jsx';
export default function ArticleReader(props) {
  const [tab, setTab] = createSignal('article');
  return (
    <>
      <div class="record-detail-tabs" role="tablist" aria-label="Article sections">
        <button role="tab" aria-selected={tab() === 'article'} onClick={() => setTab('article')}>
          Article
        </button>
        <button
          role="tab"
          aria-selected={tab() === 'attachments'}
          onClick={() => setTab('attachments')}
        >
          Attachments
        </button>
      </div>
      <Show when={tab() === 'article'}>
        <ArticleEditor readOnly content={props.body || ''} />
      </Show>
      <Show when={tab() === 'attachments'}>
        <ArticleAttachments articleId={props.articleId} />
      </Show>
    </>
  );
}
