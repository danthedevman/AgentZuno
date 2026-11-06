import { createUniqueId } from 'solid-js';
import ArticleEditor from './ArticleEditor.jsx';
import ArticleAttachments from './ArticleAttachments.jsx';

export default function ArticleReader(props) {
  const attachmentsHeading = createUniqueId();
  return (
    <div class="article-reader-layout">
      <div class="article-reader-content">
        <ArticleEditor readOnly content={props.body || ''} />
      </div>
      <aside class="article-reader-attachments" aria-labelledby={attachmentsHeading}>
        <h2 id={attachmentsHeading}>Attachments</h2>
        <ArticleAttachments articleId={props.articleId} />
      </aside>
    </div>
  );
}
