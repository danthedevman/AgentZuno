import test from 'node:test';
import assert from 'node:assert/strict';
import { validateValue } from '../../src/services/formValidation.js';

test('form validation checks required values, email, URL and bounded secrets without exposing values', () => {
  assert.match(validateValue({ label: 'Name', value: '   ', required: true }), /Enter name/);
  assert.match(validateValue({ type: 'email', value: 'invalid' }), /email/);
  assert.equal(validateValue({ type: 'email', value: 'person@example.com' }), '');
  for (const value of [
    'not a url',
    'http://example.com',
    'https://user:secret@example.com',
    'https://example.com/#fragment',
  ])
    assert.ok(validateValue({ type: 'url', value }));
  assert.equal(validateValue({ type: 'url', value: 'https://example.com/api' }), '');
  assert.match(validateValue({ value: 'secret', minLength: 12 }), /12/);
  assert.match(validateValue({ value: 'secret', maxLength: 4 }), /4/);
  assert.equal(validateValue({ value: 'secret', maxLength: 4 }).includes('secret'), false);
  assert.ok(validateValue({ value: 'bad/header', pattern: '[a-zA-Z][a-zA-Z0-9-]{0,63}' }));
});

test('form validation requires actual reference selections and whole bounded numbers', () => {
  assert.ok(
    validateValue({
      label: 'Knowledge base',
      reference: true,
      value: 'Typed but not selected',
      selectedCount: 0,
      required: true,
    }),
  );
  assert.equal(validateValue({ reference: true, value: '', selectedCount: 1, required: true }), '');
  assert.equal(validateValue({ reference: true, selectedCount: 0, required: false }), '');
  for (const value of ['10', '20000', '300.5'])
    assert.ok(validateValue({ type: 'number', value, min: 256, max: 16384, step: '1' }));
  assert.equal(
    validateValue({ type: 'number', value: '4096', min: 256, max: 16384, step: '1' }),
    '',
  );
});

test('form validation rejects empty, oversized and wrong-type uploads', () => {
  assert.ok(validateValue({ type: 'file', required: true }));
  assert.equal(validateValue({ type: 'file', required: false }), '');
  assert.ok(validateValue({ type: 'file', file: { size: 0 } }));
  assert.ok(
    validateValue({ type: 'file', maxBytes: 4 * 1024 * 1024, file: { size: 5 * 1024 * 1024 } }),
  );
  assert.ok(
    validateValue({
      type: 'file',
      accept: '.json,application/json',
      file: { size: 10, name: 'export.txt', type: 'text/plain' },
    }),
  );
  assert.equal(
    validateValue({
      type: 'file',
      accept: '.json,application/json',
      file: { size: 10, name: 'export.json', type: '' },
    }),
    '',
  );
});
