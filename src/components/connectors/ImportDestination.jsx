import { Show } from 'solid-js';
import Dropdown from '../Dropdown.jsx';
import { useWorkspace } from '../../context/WorkspaceContext.jsx';

export default function ImportDestination(props) {
  const { workspace } = useWorkspace();
  return (
    <>
      <label>
        Import destination
        <Dropdown
          name="destination"
          ariaLabel="Import destination"
          value={props.value}
          onChange={props.onChange}
          options={[
            { value: 'existing', label: 'Bundle into an existing knowledge base' },
            { value: 'source', label: 'Create knowledge bases with source names' },
          ]}
        />
      </label>
      <Show when={props.value === 'existing'}>
        <label>
          Knowledge base
          <Dropdown
            name="knowledgeBaseId"
            defaultValue={props.knowledgeBaseId}
            ariaLabel="Destination knowledge base"
            options={(workspace()?.knowledgeBases || []).map((base) => ({
              value: base.id,
              label: base.name,
            }))}
          />
        </label>
      </Show>
      <Show when={props.value === 'source'}>
        <small>
          Source names are preserved. Imported bases remain private and require explicit agent
          grants.
        </small>
      </Show>
    </>
  );
}
