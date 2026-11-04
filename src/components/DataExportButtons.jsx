import ActionMenu from './ActionMenu.jsx';
import { createSignal } from 'solid-js';
import { downloadRecords } from '../services/tableExport.js';
import { api } from '../services/api.js';
import { useToasts } from '../context/ToastContext.jsx';
export default function DataExportButtons(props) {
  const [busy, setBusy] = createSignal(false);
  const { notify } = useToasts();
  async function download(format) {
    setBusy(true);
    try {
      const rows = props.rows || [];
      await api('/api/helpdesk/exports', {
        method: 'POST',
        body: JSON.stringify({ source: '/api/reports', format, count: rows.length }),
      });
      downloadRecords(rows, props.columns, format, props.label || 'Report');
    } catch (error) {
      notify({ tone: 'error', message: error.message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div class="record-export-actions">
      <ActionMenu
        label={`More ${props.label || 'report'} actions`}
        disabled={busy()}
        items={[
          { label: 'Export CSV', onClick: () => download('csv') },
          { label: 'Export JSON', onClick: () => download('json') },
        ]}
      />
    </div>
  );
}
