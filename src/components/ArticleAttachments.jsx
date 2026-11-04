import ToastMessage from './ToastMessage.jsx';
import AttachmentPanel from './AttachmentPanel.jsx';
import { useParams } from '@solidjs/router';
import { For, Show, createResource } from 'solid-js';
import { api } from '../services/api.js';
export default function ArticleAttachments(props) {
  const params = useParams();
  const [files] = createResource(
    () => props.articleId || false,
    (id) => api(`/api/helpdesk/article-attachment-list/${id}`),
  );
  return (
    <>
      <Show when={files.error}>
        <ToastMessage tone="error">{files.error.message}</ToastMessage>
      </Show>
      <AttachmentPanel
        loading={files.loading}
        files={(files.error ? [] : files() || []).map((file) => ({
          ...file,
          href: `/api/helpdesk/article-attachments/${file.id}?article=${encodeURIComponent(props.articleId)}&workspace=${encodeURIComponent(params.workspaceId || '')}`,
        }))}
      />
    </>
  );
}
