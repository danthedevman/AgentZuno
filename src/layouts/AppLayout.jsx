import UnsavedChangesGuard from '../components/UnsavedChangesGuard.jsx';
import ConfirmationDialog from '../components/ConfirmationDialog.jsx';
import { ToastProvider } from '../context/ToastContext.jsx';
import { ErrorBoundary } from 'solid-js';
import { SessionProvider } from '../context/SessionContext.jsx';

export default function AppLayout(props) {
  return (
    <ToastProvider>
      <SessionProvider>
        <ErrorBoundary
          fallback={(error, reset) => (
            <main class="empty-state">
              <h1>Something went wrong.</h1>
              <p>{error.message}</p>
              <button onClick={reset}>Try again</button>
              <a href="/workspace">Return to workspace</a>
            </main>
          )}
        >
          {props.children}
        </ErrorBoundary>
        <UnsavedChangesGuard />
        <ConfirmationDialog />
      </SessionProvider>
    </ToastProvider>
  );
}
