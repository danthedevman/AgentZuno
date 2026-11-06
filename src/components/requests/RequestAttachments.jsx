import { createResource, createSignal, Show } from 'solid-js';
import { useParams } from '@solidjs/router';
import { api } from '../../services/api.js';
import { useToasts } from '../../context/ToastContext.jsx';
import AttachmentPanel from '../AttachmentPanel.jsx';
import ToastMessage from '../ToastMessage.jsx';
export default function RequestAttachments(props) {
  const params = useParams(),
    { notify } = useToasts();
  const source = () => `/api/helpdesk/request-attachments/${props.requestId}`;
  const [files, { refetch }] = createResource(
    () => props.requestId,
    () => api(source()),
  );
  const [uploading, setUploading] = createSignal(false);
  async function upload(selected) {
    if (uploading()) return;
    if (
      selected.length + (files()?.length || 0) > 50 ||
      selected.some((file) => !file.size || file.size > 10 * 1024 * 1024)
    ) {
      notify({ tone: 'error', message: 'Choose up to 50 attachments, each up to 10 MB.' });
      return;
    }
    setUploading(true);
    try {
      for (const file of selected)
        await api(source(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name),
          },
          body: file,
        });
      await refetch();
      await props.onChanged?.();
      notify({ tone: 'success', message: 'Attachments uploaded.' });
    } catch (error) {
      notify({ tone: 'error', message: error.message });
      await refetch();
    } finally {
      setUploading(false);
    }
  }
  return (
    <>
      <Show when={files.error}>
        <ToastMessage tone="error">{files.error.message}</ToastMessage>
      </Show>
      <AttachmentPanel
        files={(files.error ? [] : files() || []).map((file) => ({
          ...file,
          href: `${source()}/${file.id}?workspace=${params.workspaceId}`,
        }))}
        loading={files.loading}
        busy={uploading()}
        onFiles={props.canUpload ? upload : undefined}
      />
    </>
  );
}
