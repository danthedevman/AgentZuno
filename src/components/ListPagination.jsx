import { For } from 'solid-js';
import Dropdown from './Dropdown.jsx';

export default function ListPagination(props) {
  const pages = () => Math.max(1, Math.ceil(props.total / props.pageSize));
  const pageNumbers = () => {
    const selected = [1, props.page - 1, props.page, props.page + 1, pages()].filter(
      (page) => page >= 1 && page <= pages(),
    );
    const sorted = [...new Set(selected)].sort((a, b) => a - b);
    return sorted.flatMap((page, index) =>
      index && page - sorted[index - 1] > 1 ? ['ellipsis', page] : [page],
    );
  };
  return (
    <nav class="record-pagination" aria-label="List pagination">
      <div class="record-page-buttons">
        <button
          type="button"
          class="workspace-button secondary small"
          aria-label="First page"
          disabled={props.loading || props.page <= 1}
          onClick={() => props.onPage(1)}
        >
          «
        </button>
        <button
          type="button"
          class="workspace-button secondary small"
          aria-label="Previous page"
          disabled={props.loading || props.page <= 1}
          onClick={() => props.onPage(props.page - 1)}
        >
          ‹
        </button>
        <For each={pageNumbers()}>
          {(page) =>
            page === 'ellipsis' ? (
              <span class="record-page-ellipsis" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                type="button"
                class="workspace-button secondary small"
                aria-label={`Page ${page}`}
                aria-current={page === props.page ? 'page' : undefined}
                disabled={props.loading}
                onClick={() => props.onPage(page)}
              >
                {page}
              </button>
            )
          }
        </For>
        <button
          type="button"
          class="workspace-button secondary small"
          aria-label="Next page"
          disabled={props.loading || props.page >= pages()}
          onClick={() => props.onPage(props.page + 1)}
        >
          ›
        </button>
        <button
          type="button"
          class="workspace-button secondary small"
          aria-label="Last page"
          disabled={props.loading || props.page >= pages()}
          onClick={() => props.onPage(pages())}
        >
          »
        </button>
      </div>
      <span class="record-page-count" role="status">
        Page {props.page} of {pages()} · {props.total} Records
      </span>
      <div class="record-page-size">
        <Dropdown
          ariaLabel="Records per page"
          value={String(props.pageSize)}
          options={[10, 20, 50, 100].map((value) => ({
            value: String(value),
            label: String(value),
          }))}
          onChange={(value) => props.onPageSize(Number(value))}
          disabled={props.loading}
        />
      </div>
    </nav>
  );
}
