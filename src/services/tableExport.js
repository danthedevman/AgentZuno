const aliases = {
  Time: 'startedAt',
  Actor: 'actorId',
  Action: 'action',
  Target: 'target',
  Outcome: 'outcome',
  Role: 'role',
  Version: 'versionAfter',
  Updated: 'updatedAt',
  Created: 'createdAt',
  Request: 'title',
  Subject: 'title',
  Workflow: 'name',
  User: 'email',
  Connector: 'name',
  Queue: 'queueName',
  Group: 'name',
  'Assignment Group': 'queueName',
  'Assignment Groups': 'queues',
  'Approval Group': 'approvalEnabled',
};
export function exportCell(column, row) {
  const getter = column.exportValue || column.sortValue;
  if (getter) return getter(row);
  const key =
    column.key ||
    aliases[column.label] ||
    column.label?.charAt(0).toLowerCase() + column.label?.slice(1);
  const value = row.labels?.[key] ?? row.values?.[key] ?? row[key];
  if (value !== undefined && value !== null) return value;
  if (column.label === 'Action') return row.method || '';
  if (column.label === 'Version') return row.versionBefore ?? '';
  if (column.label === 'Actor') return row.actorType || 'System';
  if (column.label === 'Role') return 'System';
  if (column.label === 'Status' && typeof row.active === 'boolean')
    return row.active ? 'Active' : 'Inactive';
  return '';
}
export function recordsCsv(rows, columns) {
  const cell = (value) => {
    let text =
      value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    // Prevent spreadsheet formula evaluation, including after leading whitespace.
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return (
    '\ufeff' +
    [
      columns.map((column) => cell(column.label)).join(','),
      ...rows.map((row) => columns.map((column) => cell(exportCell(column, row))).join(',')),
    ].join('\r\n')
  );
}
export async function loadExportRows(api, source, params) {
  const rows = [],
    seen = new Set();
  for (let page = 1; page <= 100; page++) {
    const query = new URLSearchParams({
      ...params,
      list: '1',
      page: String(page),
      pageSize: '100',
    });
    const separator = source.includes('?') ? '&' : '?';
    const result = await api(`${source}${separator}${query}`);
    if (!Array.isArray(result.rows) || result.total > 10000)
      throw new Error('Limit exports to 10,000 records by narrowing your search or date range.');
    for (const row of result.rows) {
      const id = row.id || row.userId || row._id;
      if (id && seen.has(String(id)))
        throw new Error('Records changed during export. Please retry.');
      if (id) seen.add(String(id));
      rows.push(row);
    }
    if (!result.hasNext) return rows;
  }
  throw new Error('Narrow your search before exporting.');
}
export function downloadRecords(rows, columns, format, label) {
  const blob = new Blob(
    [format === 'csv' ? recordsCsv(rows, columns) : JSON.stringify(rows, null, 2)],
    { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' },
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.${format}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
