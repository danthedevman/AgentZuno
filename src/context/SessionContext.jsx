import { browserTimeZone } from '../services/timezones.js';
import { useLocation } from '@solidjs/router';
import { createContext, createResource, useContext } from 'solid-js';
import { api } from '../services/api.js';

const SessionContext = createContext();

export function SessionProvider(props) {
  const location = useLocation();
  const mode = () => (/^\/demo(?:\/|$)/.test(location.pathname) ? 'demo' : 'live');
  const [resource, { refetch }] = createResource(mode, async (source) => ({
    ...(import.meta.env.VITE_STATIC_SITE === 'true'
      ? { user: null }
      : await api('/api/auth/session', { demo: source === 'demo' })),
    mode: source,
  }));
  const session = () => (!resource.error && resource()?.mode === mode() ? resource() : undefined);
  for (const key of ['loading', 'error', 'state'])
    Object.defineProperty(session, key, { get: () => resource[key] });
  const [preferences, { mutate: updatePreferences, refetch: refreshPreferences }] = createResource(
    () => session()?.user?.id || false,
    () => api('/api/auth/preferences'),
  );
  async function savePreferences(value) {
    const saved = await api('/api/auth/preferences', {
      method: 'PUT',
      body: JSON.stringify(value),
    });
    updatePreferences(saved);
    return saved;
  }
  async function signIn(email, password) {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    await refetch();
  }
  async function register(email, password, name) {
    await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, timezone: browserTimeZone() }),
    });
    await refetch();
  }
  async function signOut() {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
    await refetch();
  }
  return (
    <SessionContext.Provider
      value={{
        session,
        signIn,
        register,
        signOut,
        refreshSession: refetch,
        preferences,
        savePreferences,
      }}
    >
      {props.children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
