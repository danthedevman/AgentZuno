import test from 'node:test';
import assert from 'node:assert/strict';
import { listResponse, requestListColumns } from '../src/listQuery.js';
test('server list queries search and order the full result set before pagination', () => {
  const rows = Array.from({ length: 60 }, (_, index) => ({
    id: String(index),
    title: `Request ${index}`,
    updatedAt: new Date(2026, 0, index + 1).toISOString(),
    status: 'open',
  }));
  const page = listResponse(
    { query: { list: '1', sort: 'Updated', direction: 'desc', page: '2' } },
    rows,
    requestListColumns,
  );
  assert.equal(page.total, 60);
  assert.equal(page.rows.length, 20);
  assert.equal(page.rows[0].id, '39');
  const search = listResponse(
    { query: { list: '1', q: 'Request 59', sort: 'Subject' } },
    rows,
    requestListColumns,
  );
  assert.equal(search.total, 1);
  assert.equal(search.rows[0].id, '59');
  assert.throws(
    () => listResponse({ query: { list: '1', sort: 'workNotes' } }, rows, requestListColumns),
    { status: 400 },
  );
  assert.throws(
    () => listResponse({ query: { list: '1', pageSize: '100000' } }, rows, requestListColumns),
    { status: 400 },
  );
  assert.equal(listResponse({ query: {} }, rows, requestListColumns), rows);
});
test('server list sorting supports numbers and case-insensitive natural ordering with missing values last', () => {
  const rows = [
    { id: 'a', name: 'record 10', count: 10 },
    { id: 'b', name: 'Record 2', count: 2 },
    { id: 'c', name: 'Record 3' },
  ];
  const result = (sort, direction) =>
    listResponse({ query: { list: '1', sort, direction } }, rows, {
      Name: 'name',
      Count: 'count',
    }).rows.map((item) => item.id);
  assert.deepEqual(result('Name', 'asc'), ['b', 'c', 'a']);
  assert.deepEqual(result('Count', 'desc'), ['a', 'b', 'c']);
});
