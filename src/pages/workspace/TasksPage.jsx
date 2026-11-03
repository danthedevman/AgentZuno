import { displayLabel } from '../../services/displayLabels.js';
import A from '../../components/WorkspaceLink.jsx';
import { For, Show } from 'solid-js';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';
import PageHeading from '../../components/PageHeading.jsx';
import Icon from '../../components/Icon.jsx';

export default function TasksPage() {
  const { workspace } = useWorkspace();
  return (
    <>
      <PageHeading title="Content tasks" />
      <Show
        when={workspace()?.tasks.length}
        fallback={
          <div class="empty-state">
            <Icon name="task" />
            <h2>A fresh start for useful knowledge.</h2>
            <p>
              Your personal workspace will keep your content tasks here. Try a demo account to see
              an example.
            </p>
            <A class="workspace-button" href="/login">
              Sign in to a demo workspace <Icon name="arrow" />
            </A>
          </div>
        }
      >
        <div class="task-list">
          <For each={workspace()?.tasks}>
            {(task) => (
              <article>
                <Icon name="task" />
                <div>
                  <h2>{task.name}</h2>
                  <p>{task.description}</p>
                </div>
                <span class="task-status">{displayLabel(task.status)}</span>
              </article>
            )}
          </For>
        </div>
        <p class="preview-note">Tasks are read-only examples in this preview.</p>
      </Show>
    </>
  );
}
