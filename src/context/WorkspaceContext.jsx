import { useToasts } from './ToastContext.jsx';
import { createContext, createResource, createSignal, useContext } from 'solid-js';
import { useParams } from '@solidjs/router';
import { api } from '../services/api.js';
import { useSession } from './SessionContext.jsx';

const WorkspaceContext = createContext();

export function WorkspaceProvider(props) {
  const { session } = useSession();
  const params = useParams();
  const { notify } = useToasts();
  const sectionNames = new Set([
    'articles',
    'knowledgeBases',
    'files',
    'images',
    'integrations',
    'tasks',
    'topics',
  ]);
  const [sectionVersion, setSectionVersion] = createSignal(0);
  let identity = '';
  const loaded = new Set();
  const pending = new Map();
  const endpoint = () =>
    params.workspaceId ? `/api/workspaces/${params.workspaceId}` : '/api/workspace';
  const identityKey = () => `${session()?.user?.id || 'guest'}:${params.workspaceId || ''}`;
  const [workspace, { refetch, mutate }] = createResource(
    () =>
      session.loading ? false : `${session()?.user?.id || 'guest'}:${params.workspaceId || ''}`,
    async () => {
      const key = identityKey();
      if (identity !== key) {
        identity = key;
        loaded.clear();
        pending.clear();
      }
      if (
        params.workspaceId &&
        session()?.user &&
        params.workspaceId !== session().user.workspaceId
      )
        return {
          id: params.workspaceId,
          name: 'Help desk',
          articles: [],
          knowledgeBases: [],
          files: [],
          images: [],
          agents: [],
          integrations: [],
          topics: [],
        };
      return api(`${endpoint()}?sections=${[...loaded].join(',') || 'none'}`);
    },
  );
  function wrap(value) {
    if (!value) return value;
    return new Proxy(value, {
      get(target, key) {
        if (
          sectionNames.has(key) &&
          !loaded.has(key) &&
          !pending.has(key) &&
          !workspace.loading &&
          identity === identityKey() &&
          (!params.workspaceId || params.workspaceId === session()?.user?.workspaceId)
        ) {
          const expected = identity;
          const operation = api(`${endpoint()}?sections=${key}`)
            .then((result) => {
              if (identity !== expected) return;
              loaded.add(key);
              setSectionVersion((value) => value + 1);
              mutate((current) => (current ? { ...current, [key]: result[key] || [] } : current));
            })
            .catch((error) => {
              if (identity === expected) notify({ tone: 'error', message: error.message });
            })
            .finally(() => {
              if (identity === expected) pending.delete(key);
            });
          pending.set(key, operation);
        }
        return Reflect.get(target, key);
      },
    });
  }
  const currentWorkspace = () => wrap(workspace());
  currentWorkspace.sectionLoaded = (name) => {
    sectionVersion();
    return loaded.has(name);
  };
  for (const property of ['loading', 'error', 'state'])
    Object.defineProperty(currentWorkspace, property, { get: () => workspace[property] });
  Object.defineProperty(currentWorkspace, 'latest', { get: () => wrap(workspace.latest) });
  return (
    <WorkspaceContext.Provider
      value={{
        workspace: currentWorkspace,
        access: props.access,
        refreshAccess: props.refreshAccess,
        refresh: refetch,
        updateArticle: (article) => {
          mutate((current) =>
            current
              ? {
                  ...current,
                  articles: current.articles.map((item) =>
                    item.id === article.id ? { ...item, ...article } : item,
                  ),
                }
              : current,
          );
        },
      }}
    >
      {props.children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
