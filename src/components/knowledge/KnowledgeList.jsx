import { Show } from 'solid-js';
import RecordTable from '../records/RecordTable.jsx';
import A from '../WorkspaceLink.jsx';
import Icon from '../Icon.jsx';
import { contentStatus } from '../../services/contentStatus.js';
export default function KnowledgeList(props) {
  const hasStatus = () => props.label === 'Articles';
  return (
    <RecordTable
      bulkDelete={hasStatus() ? 'articles' : undefined}
      onEmptyChange={props.onEmptyChange}
      label={props.label}
      emptyAction={
        props.emptyAction ||
        (props.label === 'Knowledge Bases'
          ? { label: 'Add Knowledge Base', href: '/workspace/create/knowledge-base' }
          : props.label === 'Topics'
            ? {
                label: 'Add Topic',
                href: `/workspace/knowledge/topics/new${props.sourceParams?.base ? `?base=${encodeURIComponent(props.sourceParams.base)}` : ''}`,
              }
            : {
                label: 'Add Article',
                href: `/workspace/create/article${props.sourceParams?.base ? `?base=${encodeURIComponent(props.sourceParams.base)}${props.sourceParams?.topic ? `&topic=${encodeURIComponent(props.sourceParams.topic)}` : ''}` : ''}`,
              })
      }
      source={props.source}
      sourceParams={props.sourceParams}
      query={props.query}
      rows={[]}
      defaultSort={{ key: 'Name', direction: 'asc' }}
      columns={[
        {
          label: 'Name',
          sortValue: (item) => item.title,
          render: (item) => (
            <A class="article-table-title" href={item.href}>
              <span class="activity-type-badge" data-type="article">
                <Icon name={item.icon} />
              </span>
              <span>
                <strong>{item.title}</strong>
                <small>{item.description || item.kind}</small>
              </span>
            </A>
          ),
        },
        ...(hasStatus()
          ? [
              {
                label: 'Status',
                sortValue: (item) => contentStatus({ status: item.status }).label,
                render: (item) => (
                  <span
                    class="activity-status"
                    data-tone={contentStatus({ status: item.status }).tone}
                  >
                    <span class="activity-status-dot" />
                    {contentStatus({ status: item.status }).label}
                  </span>
                ),
              },
            ]
          : []),
        {
          label: props.label === 'Articles' ? 'Knowledge Base' : 'Articles',
          sortValue: (item) => item.articleCount ?? (item.details || []).join(', '),
          render: (item) =>
            item.articleCount ?? (item.baseName || (item.details || []).join(', ') || '—'),
        },
        {
          label: 'Updated',
          defaultDirection: 'desc',
          sortValue: (item) => (item.updatedAt ? Date.parse(item.updatedAt) : null),
          render: (item) => (
            <div class="record-cell-actions">
              <Show
                when={item.updatedAt && Number.isFinite(Date.parse(item.updatedAt))}
                fallback="—"
              >
                <time datetime={item.updatedAt}>
                  {new Date(item.updatedAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </time>
              </Show>
            </div>
          ),
        },
      ]}
      emptyText={props.emptyText || 'No items found.'}
    />
  );
}
