import Skeleton from '../Skeleton.jsx';
export default function ArticleLoading() {
  return (
    <div class="article-layout" aria-busy="true">
      <div class="article-main-content">
        <Skeleton label="Loading article title" lines={2} />
        <Skeleton label="Loading article content" lines={12} />
      </div>
      <aside class="article-details-panel">
        <div class="article-panel-heading">
          <Skeleton label="Loading article actions" lines={1} />
        </div>
        <div class="article-panel-content">
          <Skeleton label="Loading article details" lines={10} />
        </div>
      </aside>
    </div>
  );
}
