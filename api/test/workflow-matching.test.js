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

test('catalog form discovery matches reordered subject and action words without exposing ambiguous forms', () => {
  const portal = {
    id: 'portal',
    name: 'Employee Portal Update Request',
    department: 'it',
    keywords: ['update employee portal'],
    definition: { form: { title: 'Employee Portal Update Request', fields: [] } },
  };
  for (const message of [
    'i need to update my pages in our portal',
    'Can I edit our portal pages?',
    'Please change my employee portal page',
  ])
    assert.equal(findWorkflowMatch([portal], null, message, true)?.id, 'portal');
  for (const message of [
    'What is the portal?',
    'I need a laptop',
    'Do not update the portal',
    'I need a portal password reset',
  ])
    assert.equal(findWorkflowMatch([portal], null, message, true), null);
  assert.equal(
    findWorkflowMatch(
      [portal, { ...portal, id: 'other' }],
      null,
      'I need to edit our portal pages',
      true,
    ),
    null,
  );
  assert.equal(findWorkflowMatch([portal], 'hr', 'I need to update our portal', true), null);
});
