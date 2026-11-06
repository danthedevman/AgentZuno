import { Show } from 'solid-js';
import ActionMenu from '../ActionMenu.jsx';
import Icon from '../Icon.jsx';

export default function DashboardToolbar(props) {
  return (
    <div class="dashboard-toolbar" data-list-actions>
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
        <Show when={props.actions?.length}>
          <ActionMenu
            label={props.actionsLabel || 'Dashboard actions'}
            items={props.actions}
            disabled={props.disabled}
          />
        </Show>
      </div>
    </div>
  );
}
