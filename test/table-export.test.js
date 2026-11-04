import test from 'node:test';
import assert from 'node:assert/strict';
import { recordsCsv, loadExportRows } from '../src/services/tableExport.js';
test('CSV escapes quotes, multiline values and spreadsheet formulas', () => {
  const csv = recordsCsv(
    [{ name: 'A,"B"\nC', status: ' =HYPERLINK("unsafe")' }],
    [
      { label: 'Name', key: 'name' },
      { label: 'Status', key: 'status' },
    ],
  );
  assert.ok(csv.startsWith('\ufeff"Name","Status"'));
  assert.ok(csv.includes('"A,""B""\nC"'));
  assert.ok(csv.includes('"\' =HYPERLINK'));
});
test('exports request all pages with server search, sort and bounded limits', async () => {
  const urls = [];
  const rows = await loadExportRows(
    async (url) => {
      urls.push(url);
      return { rows: [{ id: String(urls.length) }], total: 2, hasNext: urls.length === 1 };
    },
    '/api/helpdesk/audit',
    { q: 'workflow', sort: 'Time', direction: 'desc' },
  );
  assert.equal(rows.length, 2);
  assert.match(urls[1], /page=2/);
  assert.match(urls[0], /q=workflow/);
  await assert.rejects(
    loadExportRows(async () => ({ rows: [], total: 10001 }), '/api/helpdesk/audit', {}),
    /10,000/,
  );
});
