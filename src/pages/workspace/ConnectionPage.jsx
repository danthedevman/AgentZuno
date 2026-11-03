import Skeleton from '../../components/Skeleton.jsx';
import { useParams } from '@solidjs/router';
import { For, Show, createResource } from 'solid-js';
import ConnectSource from '../../components/ConnectSource.jsx';
import PageHeading from '../../components/PageHeading.jsx';
import { api } from '../../services/api.js';

export default function ConnectionPage() {
  const params = useParams();
  const [catalog] = createResource(
    () => params.provider,
    (provider) => api(`/api/integration-catalog?provider=${encodeURIComponent(provider)}`),
  );
  const app = () =>
    catalog()?.find((item) => item.id === params.provider && item.id !== 'servicenow');
  return (
    <section class="reading-page">
      <Show
        when={app()}
        fallback={
          <Show when={!catalog.loading} fallback={<Skeleton label="Loading app setup" lines={7} />}>
            <h1>App unavailable</h1>
          </Show>
        }
      >
        <PageHeading title={app()?.name} />
        <p>{app()?.description}</p>
        <h2>Importable knowledge</h2>
        <ul>
          <For each={app()?.importTypes || []}>{(type) => <li>{type}</li>}</For>
        </ul>
        <dl class="agent-details">
          <dt>Category</dt>
          <dd>{app()?.category}</dd>
          <dt>Status</dt>
          <dd>
            {app()?.id === 'servicenow'
              ? app()?.adapterStatus
              : app()?.adapterImplemented
                ? 'Import adapter available · source setup required'
                : app()?.id === 'custom'
                  ? 'JSON snapshot import · no live sync'
                  : 'Export import available · direct adapter not implemented'}
          </dd>
        </dl>
        <ConnectSource app={app()} />
        <Show when={app()?.docsUrl}>
          <p>
            <a href={app()?.docsUrl} target="_blank" rel="noreferrer">
              Source API documentation
            </a>
          </p>
        </Show>
      </Show>
    </section>
  );
}
