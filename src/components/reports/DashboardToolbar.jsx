import { Show } from 'solid-js';
import ActionMenu from '../ActionMenu.jsx';
import Icon from '../Icon.jsx';
import PageHeading from '../PageHeading.jsx';
import { useDashboardActions } from '../../context/DashboardActionsContext.jsx';

export default function DashboardToolbar(props) {
  const dashboardActions = useDashboardActions();
  const items = () => [...(props.actions || []), ...(dashboardActions?.items() || [])];
  return (
    <div class="dashboard-toolbar" classList={{ 'has-title': !!props.title }} data-list-actions>
      <Show when={props.title}>
        <PageHeading title={props.title} />
      </Show>
      <div class="dashboard-toolbar-filters">{props.children}</div>
      <div class="dashboard-toolbar-actions">
        <button
          type="button"
          class="workspace-button secondary small refresh-icon-button"
          aria-label={props.refreshLabel || 'Refresh report'}
          disabled={props.loading || props.disabled}
          onClick={props.onRefresh}
        >
          <Icon name="refresh" />
        </button>
        <Show when={items().length}>
          <ActionMenu
            label={props.actionsLabel || 'Dashboard actions'}
            items={items()}
            disabled={props.disabled}
          />
        </Show>
      </div>
    </div>
  );
}
