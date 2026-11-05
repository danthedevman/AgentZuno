import PageError from '../components/PageError.jsx';
import PageMetadata from '../components/PageMetadata.jsx';
import UnsavedChangesGuard from '../components/UnsavedChangesGuard.jsx';
import ConfirmationDialog from '../components/ConfirmationDialog.jsx';
import { ToastProvider } from '../context/ToastContext.jsx';
import { ErrorBoundary } from 'solid-js';
import { SessionProvider } from '../context/SessionContext.jsx';

export default function AppLayout(props) {
  return (
    <ToastProvider>
      <PageMetadata />
      <SessionProvider>
        <ErrorBoundary fallback={(error, reset) => <PageError onRetry={reset} />}>
          {props.children}
        </ErrorBoundary>
        <UnsavedChangesGuard />
        <ConfirmationDialog />
      </SessionProvider>
    </ToastProvider>
  );
}
