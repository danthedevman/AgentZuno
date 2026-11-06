import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, changedSections } from '../src/utils/textDiff.js';

test('line reviews retain context, additions, removals and source line numbers', () => {
  const rows = diffLines('First\nOld\nLast', 'First\nNew\nLast');
  assert.deepEqual(
    rows.map((row) => row.type),
    ['context', 'remove', 'add', 'context'],
  );
  assert.deepEqual(
    rows.filter((row) => row.type !== 'add').map((row) => row.text),
    ['First', 'Old', 'Last'],
  );
  assert.deepEqual(
    rows.filter((row) => row.type !== 'remove').map((row) => row.text),
    ['First', 'New', 'Last'],
  );
  assert.deepEqual(rows.at(-1), { type: 'context', text: 'Last', oldLine: 3, newLine: 3 });
});
test('unchanged sections do not create a review and special text stays literal', () => {
  assert.deepEqual(changedSections([{ label: 'Title', before: 'Same', after: 'Same' }]), []);
  assert.equal(
    diffLines('safe', '<script>alert(1)</script>').at(-1).text,
    '<script>alert(1)</script>',
  );
});
test('large reviews use bounded comparison without losing content', () => {
  const before = Array.from({ length: 300 }, (_, index) => `Line ${index}`).join('\n');
  const after = before.replace('Line 150\n', 'Changed\n');
  const rows = diffLines(before, after);
  assert.equal(
    rows
      .filter((row) => row.type !== 'add')
      .map((row) => row.text)
      .join('\n'),
    before,
  );
  assert.equal(
    rows
      .filter((row) => row.type !== 'remove')
      .map((row) => row.text)
      .join('\n'),
    after,
  );
});
