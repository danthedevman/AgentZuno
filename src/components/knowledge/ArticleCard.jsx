import { contentStatus } from '../../services/contentStatus.js';
import A from '../WorkspaceLink.jsx';
import Icon from '../Icon.jsx';

export default function ArticleCard(props) {
  return (
    <A
      class="article-card"
      href={`${props.explore ? '/workspace/help' : '/workspace/articles'}/${props.article.id}`}
    >
      <div class="card-meta">
        <span>{props.article.label}</span>
        <span
          class="activity-status"
          data-tone={contentStatus({ ...props.article, type: 'Article' }).tone}
        >
          <span class="status-dot" />
          {contentStatus({ ...props.article, type: 'Article' }).label}
        </span>
      </div>
      <h3>{props.article.title}</h3>
      <p>{props.article.summary}</p>
      <span class="card-link">
        Read article <Icon name="arrow" />
      </span>
    </A>
  );
}
