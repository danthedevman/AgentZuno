import test from 'node:test';
import assert from 'node:assert/strict';
import { findWorkflowMatch } from '../src/workflowMatching.js';
const laptop = {
  id: 'laptop',
  department: 'it',
  keywords: ['request a laptop'],
  definition: { form: { fields: [{ type: 'select', options: ['Mac', 'Windows'] }] } },
};
test('published form discovery recognizes requests for configured choices, preserving explicit triggers and avoiding ambiguity', () => {
  for (const text of [
    'How can I request a Mac?',
    'I need a Mac',
    'Can I order a Windows laptop?',
    'I WANT A MAC FOR WORK',
  ])
    assert.equal(findWorkflowMatch([laptop], null, text, true)?.id, 'laptop');
  for (const text of [
    'What is a MAC address?',
    'I need a Windows update',
    'Can you reset my Windows password?',
    'I need a machine',
    'Mac',
  ])
    assert.equal(findWorkflowMatch([laptop], null, text, true), null);
  assert.equal(findWorkflowMatch([laptop], null, 'I need a Mac', false), null);
  assert.equal(findWorkflowMatch([laptop], 'hr', 'I need a Mac', true), null);
  assert.equal(
    findWorkflowMatch([laptop, { ...laptop, id: 'other' }], null, 'I need a Mac', true),
    null,
  );
  assert.equal(
    findWorkflowMatch([laptop], null, 'I would like to request a laptop', false)?.id,
    'laptop',
  );
  const password = { id: 'password', department: 'it', keywords: ['windows password'] };
  assert.equal(
    findWorkflowMatch([laptop, password], null, 'I need a Windows password reset', true)?.id,
    'password',
  );
});
