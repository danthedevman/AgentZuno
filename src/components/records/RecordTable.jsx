import { useDashboardActions } from '../../context/DashboardActionsContext.jsx';
import { Dynamic } from 'solid-js/web';
import Dropdown from '../Dropdown.jsx';
import ActionMenu from '../ActionMenu.jsx';
import { loadExportRows, downloadRecords } from '../../services/tableExport.js';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import { useToasts } from '../../context/ToastContext.jsx';
import { confirmAction } from '../../services/confirmations.js';
import { createStore, reconcile } from 'solid-js/store';
import ListPagination from '../ListPagination.jsx';
import { useSession } from '../../context/SessionContext.jsx';
import A from '../WorkspaceLink.jsx';
import Skeleton from '../Skeleton.jsx';
import Icon from '../Icon.jsx';
import { api } from '../../services/api.js';
import { useParams } from '@solidjs/router';
import { recordViewKey, recordCardVariant } from '../../utils/recordViews.js';
import ToastMessage from '../ToastMessage.jsx';
import {
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  createUniqueId,
  onMount,
  onCleanup,
} from 'solid-js';
function RecordRow(props) {
  let row;
  const [actionable, setActionable] = createSignal(false);
  onMount(() =>
    setActionable(!!props.onOpen || !!row.querySelector('a[href], button.record-table-link')),
  );
  function open() {
    if (props.onOpen) props.onOpen(props.record);
    else row.querySelector('a[href], button.record-table-link')?.click();
  }
  return (
    <Dynamic
      component={props.card ? 'article' : 'tr'}
      ref={row}
      class={props.card ? 'record-mobile-card record-card' : undefined}
      classList={{ 'record-row-actionable': actionable() }}
      tabindex={actionable() ? 0 : undefined}
      onClick={(event) => {
        if (!event.target.closest('a,button,input,textarea,[role="combobox"]')) open();
      }}
      onKeyDown={(event) => {
        if (event.target === row && ['Enter', ' '].includes(event.key) && actionable()) {
          event.preventDefault();
          open();
        }
      }}
    >
      <For each={props.columns}>
        {(column) => (
          <Dynamic
            component={props.card ? 'div' : 'td'}
            class={`${props.card ? 'record-mobile-field' : ''} ${column.className || ''}`}
            classList={{
              'record-primary-field':
                props.card && column === props.columns.find((item) => item.label),
              'record-status-field': props.card && column.label === 'Status',
            }}
          >
            <Show
              when={
                props.card && column.label && column !== props.columns.find((item) => item.label)
              }
            >
              <span class="record-mobile-field-label">{column.label}</span>
            </Show>
            {column.render
              ? column.render(props.record, { card: props.card })
              : props.record[column.key]}
          </Dynamic>
        )}
      </For>
    </Dynamic>
  );
}
export default function RecordTable(props) {
  const params = useParams();
  const { session } = useSession();
  const [view, setView] = createSignal('cards');
  const preferenceKey = () =>
    recordViewKey(session()?.user?.id, params.workspaceId, props.source, props.label);
  createEffect(() => {
    const key = preferenceKey();
    try {
      setView(localStorage.getItem(key) === 'table' ? 'table' : 'cards');
    } catch {
      setView('cards');
    }
  });
  const cardView = () => view() === 'cards';
  function changeView(value) {
    setView(value);
    setSelected([]);
    props.onViewChange?.(value);
    try {
      localStorage.setItem(preferenceKey(), value);
    } catch {
      /* Preferences remain usable without browser storage. */
    }
  }
  let root;
  const dashboardActions = useDashboardActions();
  const actionId = createUniqueId();
  onCleanup(() => dashboardActions?.remove(actionId));
  const { access } = useWorkspace();
  const { notify } = useToasts();
  const canDelete = () => !!props.bulkDelete && access()?.role === 'admin';
  const [selected, setSelected] = createSignal([]);
  const [deleting, setDeleting] = createSignal(false);
  const [exporting, setExporting] = createSignal(false);
  async function exportRecords(format, selectedOnly = false) {
    if (exporting()) return;
    setExporting(true);
    try {
      const query = {
        ...props.sourceParams,
        q: appliedSearch(),
        sort: sort().key || key(columns().find((column) => column.sortable !== false)),
        direction: sort().direction,
      };
      if (props.source === '/api/helpdesk/audit') query.until = new Date().toISOString();
      const available = props.source ? await loadExportRows(api, props.source, query) : [...rows()];
      const records = selectedOnly
        ? available.filter((row) => selected().includes(row.id))
        : available;
      await api('/api/helpdesk/exports', {
        method: 'POST',
        body: JSON.stringify({
          format,
          count: records.length,
          source: props.source?.split('?')[0] || '/api/reports',
        }),
      });
      downloadRecords(
        records,
        columns().filter((column) => column.label && column.exportable !== false),
        format,
        props.label || 'Records',
      );
      notify({ tone: 'success', message: `${records.length} records exported.` });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setExporting(false);
    }
  }

  const deletable = (row) => !row.sourceConnectionId && /^[a-f0-9]{24}$/.test(row.id);
  const selectedRows = () => rows().filter((row) => selected().includes(row.id));
  const canSelect = () =>
    props.selectable !== false &&
    !props.columns.some((column) => column.headerStart) &&
    (!!props.source || canDelete());
  const selectable = (row) => typeof row.id === 'string' && !!row.id;
  function toggle(id, checked) {
    setSelected((ids) =>
      checked ? [...new Set([...ids, id])] : ids.filter((item) => item !== id),
    );
  }
  async function deleteSelected() {
    const targets = selectedRows().filter(deletable);
    if (!canDelete() || !targets.length || deleting()) return;
    const names = targets
      .slice(0, 5)
      .map((row) => `“${row.title || row.name || row.number || row.id}”`)
      .join(', ');
    const detail =
      props.bulkDelete === 'requests'
        ? 'The requests and their submitted answers, comments, and work notes will be removed. Audit and workflow run history will remain.'
        : 'The articles and attachments not used by another article will be removed. Audit history will remain.';
    if (
      !(await confirmAction(
        `Delete ${targets.length} selected ${targets.length === 1 ? props.bulkDelete.slice(0, -1) : props.bulkDelete}? ${names}${targets.length > 5 ? ` and ${targets.length - 5} more` : ''}. ${detail} This cannot be undone.`,
        'Delete Selected Records',
        'Delete',
      ))
    )
      return;
    setDeleting(true);
    try {
      const result = await api(`/api/helpdesk/${props.bulkDelete}/bulk-delete`, {
        method: 'POST',
        body: JSON.stringify({ ids: targets.map((row) => row.id), confirmed: true }),
      });
      setSelected([]);
      if (page() !== 1) setPage(1);
      else await refetch();
      notify({ tone: 'success', message: `${result.deletedCount} ${props.bulkDelete} deleted.` });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
      await refetch();
    } finally {
      setDeleting(false);
    }
  }

  const columns = () => {
    const isUpdated = (column) => /^(updated|updatedAt)$/i.test(column.key || column.label);
    return [
      ...(!cardView() && canSelect()
        ? [
            {
              key: 'selection',
              label: '',
              sortable: false,
              className: 'record-selection-column',
              headerStart: () => (
                <input
                  type="checkbox"
                  aria-label="Select all records on this page"
                  disabled={deleting() || result.loading || !rows().some(selectable)}
                  checked={
                    !!rows().filter(selectable).length &&
                    rows()
                      .filter(selectable)
                      .every((row) => selected().includes(row.id))
                  }
                  onChange={(event) =>
                    setSelected(
                      event.currentTarget.checked
                        ? rows()
                            .filter(selectable)
                            .map((row) => row.id)
                        : [],
                    )
                  }
                />
              ),
              render: (row) => (
                <Show when={selectable(row)}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.title || row.name || row.number || 'record'}`}
                    disabled={deleting() || result.loading}
                    checked={selected().includes(row.id)}
                    onChange={(event) => toggle(row.id, event.currentTarget.checked)}
                  />
                </Show>
              ),
            },
          ]
        : []),
      ...props.columns.filter((column) => !isUpdated(column)),
      ...props.columns.filter(isUpdated).map((column) => ({
        ...column,
        className: `${column.className || ''} record-updated-column`,
      })),
    ];
  };
  const { preferences, savePreferences } = useSession();
  const pageSize = () => (preferences.error ? 20 : preferences()?.listPageSize || 20);
  const [paginationError, setPaginationError] = createSignal('');
  createEffect(() => {
    pageSize();
    setPage(1);
  });
  const [sort, setSort] = createSignal(props.defaultSort || { key: '', direction: 'asc' });
  const key = (column) => column.sortKey || column.key || column.label;
  const [page, setPage] = createSignal(1);
  const [search, setSearch] = createSignal('');
  const [appliedSearch, setAppliedSearch] = createSignal('');
  createEffect(() => {
    const query = props.query ?? search();
    const timer = setTimeout(() => {
      setAppliedSearch(query);
      setPage(1);
    }, 200);
    onCleanup(() => clearTimeout(timer));
  });
  createEffect(() => {
    props.source;
    JSON.stringify(props.sourceParams);
    setPage(1);
  });
  const viewKey = () => `${props.source || ''}:${JSON.stringify(props.sourceParams || {})}`;
  let loadedViewKey;
  const [result, { refetch }] = createResource(
    () => {
      props.refreshKey;
      if (!props.source || preferences.loading) return false;
      const url = new URL(props.source, window.location.origin);
      for (const [name, value] of Object.entries(props.sourceParams || {}))
        if (value !== undefined && value !== '') url.searchParams.set(name, value);
      url.searchParams.set('list', '1');
      url.searchParams.set(
        'sort',
        sort().key || key(columns().find((column) => column.sortable !== false)),
      );
      url.searchParams.set('direction', sort().direction);
      url.searchParams.set('q', appliedSearch());
      url.searchParams.set('page', page());
      url.searchParams.set('pageSize', String(pageSize()));
      return {
        url: `${url.pathname}${url.search}`,
        refreshKey: props.refreshKey,
        viewKey: viewKey(),
      };
    },
    async (source) => {
      const started = performance.now();
      const changedView = loadedViewKey !== source.viewKey;
      const data = await api(source.url);
      // Keep tab placeholders visible for one short transition rather than a single flash.
      if (changedView)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, 240 - (performance.now() - started))),
        );
      if (viewKey() === source.viewKey) loadedViewKey = source.viewKey;
      return { ...data, viewKey: source.viewKey };
    },
  );
  const activeResult = () => (!result.error && result()?.viewKey === viewKey() ? result() : null);
  const isPendingView = () => Boolean(props.source && !result.error && !activeResult());
  const [stableRows, setStableRows] = createStore([]);
  createEffect(() =>
    setStableRows(
      reconcile(
        props.source ? (result.error ? [] : activeResult()?.rows || []) : props.rows || [],
        {
          key: 'id',
        },
      ),
    ),
  );
  const rows = () => stableRows;
  createEffect(() => {
    const currentRows = rows();
    const currentIds = currentRows.map((row) => row.id);
    setSelected((ids) => ids.filter((id) => currentIds.includes(id)));
    props.onRowsChange?.(currentRows);
  });
  const isEmpty = () =>
    !result.loading &&
    !props.loading &&
    !result.error &&
    (!props.source || !!activeResult()) &&
    !rows().length;
  const unfilteredEmpty = () => isEmpty() && !appliedSearch() && !(props.query || search());
  createEffect(() => props.onEmptyChange?.(unfilteredEmpty()));
  const sortOptions = () =>
    columns()
      .filter((column) => column.sortable !== false)
      .flatMap((column) =>
        ['asc', 'desc'].map((direction) => ({
          value: `${key(column)}:${direction}`,
          label: `${column.label} · ${direction === 'asc' ? 'Ascending' : 'Descending'}`,
          sort: { key: key(column), direction },
        })),
      );
  function changeSort(column) {
    if (!props.source) return;
    setPage(1);
    setSort((previous) => ({
      key: key(column),
      direction:
        previous.key === key(column)
          ? previous.direction === 'asc'
            ? 'desc'
            : 'asc'
          : column.defaultDirection || 'asc',
    }));
  }
  createEffect(() => {
    dashboardActions?.register(
      actionId,
      !unfilteredEmpty() && rows().length
        ? [
            {
              label: `Export ${props.label} CSV`,
              disabled: exporting() || result.loading,
              onClick: () => exportRecords('csv'),
            },
            {
              label: `Export ${props.label} JSON`,
              disabled: exporting() || result.loading,
              onClick: () => exportRecords('json'),
            },
          ]
        : [],
    );
  });
  return (
    <div class="record-list" ref={root} data-card-variant={recordCardVariant(props.label)}>
      <Show when={!unfilteredEmpty()}>
        <div class="record-list-toolbar" role="group" aria-label={`${props.label} controls`}>
          <Show when={props.source && (props.query === undefined || props.onQueryChange)}>
            <label class="workspace-search">
              <Icon name="search" />
              <input
                type="search"
                maxlength="200"
                aria-label={`Search ${props.label}`}
                placeholder={`Search ${props.label.toLowerCase()}…`}
                value={props.query ?? search()}
                onInput={(event) =>
                  props.onQueryChange
                    ? props.onQueryChange(event.currentTarget.value)
                    : setSearch(event.currentTarget.value)
                }
              />
            </label>
          </Show>
          {props.toolbarFilters}
          {props.toolbarActions}
          <div class="record-toolbar-actions">
            <Show when={props.source && columns().some((column) => column.sortable !== false)}>
              <Dropdown
                ariaLabel="Sort records by"
                icon="sort"
                iconOnly
                value={`${sort().key || key(columns().find((column) => column.sortable !== false))}:${sort().direction}`}
                options={sortOptions()}
                onChange={(value) => {
                  const option = sortOptions().find((option) => option.value === value);
                  if (option) {
                    setPage(1);
                    setSort(option.sort);
                  }
                }}
              />
            </Show>
            <div class="record-view-toggle" role="group" aria-label={`${props.label} view`}>
              <button
                type="button"
                aria-label="Cards"
                title="Card view"
                aria-pressed={cardView()}
                onClick={() => changeView('cards')}
              >
                <Icon name="cards" />
              </button>
              <button
                type="button"
                aria-label="Table"
                title="Table view"
                aria-pressed={!cardView()}
                onClick={() => changeView('table')}
              >
                <Icon name="table" />
              </button>
            </div>
            <Show when={!dashboardActions && rows().length}>
              <ActionMenu
                label={`More ${props.label} actions`}
                disabled={exporting() || result.loading}
                items={[
                  { label: 'Export CSV', onClick: () => exportRecords('csv') },
                  { label: 'Export JSON', onClick: () => exportRecords('json') },
                ]}
              />
            </Show>
          </div>
        </div>
      </Show>
      <Show when={!cardView() && (selectedRows().length || props.selectionActions)}>
        <div class="record-selection-toolbar">
          {props.selectionActions}
          <Show when={!cardView() && selectedRows().length}>
            <div class="record-toolbar-bulk" role="region" aria-label="Selected records">
              <span aria-live="polite">{selectedRows().length} Selected</span>
              <Show when={canDelete() && selectedRows().some(deletable)}>
                <button
                  class="workspace-button secondary small icon-only"
                  aria-label={deleting() ? 'Deleting selected records' : 'Delete Selected'}
                  title="Delete selected records"
                  disabled={deleting() || result.loading}
                  onClick={deleteSelected}
                >
                  <Icon name={deleting() ? 'loading' : 'delete'} />
                </button>
              </Show>
              <button
                type="button"
                class="workspace-button secondary small icon-only"
                aria-label="Export selected records"
                title="Export selected CSV"
                disabled={exporting()}
                onClick={() => exportRecords('csv', true)}
              >
                <Icon name="download" />
              </button>
              <button
                class="workspace-button secondary small icon-only"
                aria-label="Clear Selection"
                title="Clear selection"
                disabled={deleting()}
                onClick={() => setSelected([])}
              >
                <Icon name="close" />
              </button>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={result.error}>
        <ToastMessage tone="error">{result.error.message}</ToastMessage>
      </Show>
      <Show when={!isEmpty()}>
        <div
          class="record-table-scroll"
          classList={{
            'is-ready': !!activeResult() || !props.source,
            'is-card-view': cardView(),
          }}
          aria-busy={result.loading}
        >
          <Show
            when={cardView()}
            fallback={
              <table class="record-table">
                <caption class="sr-only">{props.label}</caption>
                <thead>
                  <tr>
                    <For each={columns()}>
                      {(column) => (
                        <th
                          scope="col"
                          class={column.className}
                          aria-sort={
                            column.sortable === false || !props.source
                              ? undefined
                              : sort().key === key(column)
                                ? sort().direction === 'asc'
                                  ? 'ascending'
                                  : 'descending'
                                : 'none'
                          }
                        >
                          <div class="record-table-heading">
                            {column.headerStart?.()}
                            <Show
                              when={column.sortable !== false && props.source}
                              fallback={column.label}
                            >
                              <button
                                type="button"
                                class="record-sort-button"
                                onClick={() => changeSort(column)}
                              >
                                {column.label}
                                <Icon
                                  name={
                                    sort().key === key(column)
                                      ? sort().direction === 'asc'
                                        ? 'sort-up'
                                        : 'sort-down'
                                      : 'sort'
                                  }
                                />
                              </button>
                            </Show>
                          </div>
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <Show when={!isPendingView()}>
                    <For each={rows()}>
                      {(row) => (
                        <RecordRow record={row} columns={columns()} onOpen={props.onRowClick} />
                      )}
                    </For>
                  </Show>
                  <Show when={isPendingView()}>
                    <For each={[0, 1, 2, 3, 4]}>
                      {() => (
                        <tr aria-hidden="true">
                          <For each={columns()}>
                            {() => (
                              <td>
                                <Skeleton lines={1} />
                              </td>
                            )}
                          </For>
                        </tr>
                      )}
                    </For>
                  </Show>
                </tbody>
              </table>
            }
          >
            <div class="record-card-list" role="list" aria-label={props.label}>
              <Show
                when={!isPendingView()}
                fallback={<For each={[0, 1, 2]}>{() => <Skeleton lines={3} />}</For>}
              >
                <For each={rows()}>
                  {(record) => (
                    <div role="listitem">
                      {props.renderCard ? (
                        props.renderCard(record)
                      ) : (
                        <RecordRow
                          card
                          record={record}
                          columns={columns()}
                          onOpen={props.onRowClick}
                        />
                      )}
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
      <Show when={isEmpty()}>
        <div class="record-empty-state">
          <h3>{appliedSearch() ? 'No matches found.' : props.emptyText || 'No records yet.'}</h3>
          <Show when={props.emptyDescription}>
            <p>{props.emptyDescription}</p>
          </Show>
          <Show when={props.emptyAction}>
            {(action) => (
              <Show
                when={action().href}
                fallback={
                  <button
                    type="button"
                    class="workspace-button small"
                    onClick={() => action().onClick?.()}
                  >
                    {action().label}
                  </button>
                }
              >
                <A class="workspace-button small" href={action().href}>
                  {action().label}
                </A>
              </Show>
            )}
          </Show>
          <Show when={appliedSearch() && props.query === undefined}>
            <button
              type="button"
              class="workspace-button secondary small"
              onClick={() => setSearch('')}
            >
              Clear Search
            </button>
          </Show>
        </div>
      </Show>
      <Show when={paginationError()}>
        <ToastMessage tone="error">{paginationError()}</ToastMessage>
      </Show>
      <Show when={props.source && !result.error && activeResult()?.total > 0}>
        <ListPagination
          total={activeResult().total}
          page={activeResult().page}
          pageSize={activeResult().pageSize}
          loading={result.loading}
          onPage={setPage}
          onPageSize={async (size) => {
            try {
              await savePreferences({ listPageSize: size });
              setPage(1);
            } catch (error) {
              setPaginationError(error.message);
            }
          }}
        />
      </Show>
    </div>
  );
}
