import { createEffect } from 'solid-js';
import { A, useLocation } from '@solidjs/router';
import { useSession } from '../context/SessionContext.jsx';
import Icon from './Icon.jsx';

export default function PageError(props) {
  const { session } = useSession();
  const location = useLocation();
  const failedPath = `${location.pathname}${location.search}`;
  createEffect(() => {
    if (`${location.pathname}${location.search}` !== failedPath) props.onRetry();
  });
  const destination = () => {
    if (/^\/demo(?:\/|$)/.test(location.pathname)) return '/demo';
    const id =
      location.pathname.match(/^\/workspace\/([a-f0-9]{24})(?:\/|$)/)?.[1] ||
      session()?.user?.impersonation?.workspaceId ||
      session()?.user?.workspaceId;
    return id ? `/workspace/${id}` : '/login';
  };
  return (
    <main class="page-error" aria-labelledby="page-error-title">
      <section class="page-error-card" role="alert">
        <span class="page-error-icon">
          <Icon name="info" />
        </span>
        <h1 id="page-error-title">Something went wrong</h1>
        <p>We couldn’t load this page. Try again, or return to your workspace to continue.</p>
        <div class="page-error-actions">
          <button type="button" class="page-error-primary" onClick={props.onRetry}>
            <Icon name="refresh" />
            Try Again
          </button>
          <A class="page-error-secondary" href={destination()}>
            <Icon name="back" />
            {destination() === '/login' ? 'Go to Sign In' : 'Return to Workspace'}
          </A>
        </div>
      </section>
    </main>
  );
}
