import test from 'node:test';
import assert from 'node:assert/strict';
import { requestReceipt, insertRequestReceipt } from '../src/requests/requestReceipt.js';
test('submitted form receipts stay chronological, read-only and idempotent across follow-ups', () => {
  const ticket = {
    id: 'request',
    number: 'REQ-000001',
    createdAt: '2026-11-01T12:00:00Z',
    formSubmission: {
      title: 'Laptop Order',
      submittedAt: '2026-11-01T12:05:00Z',
      answers: [{ id: 'platform', label: 'Platform', value: 'Mac' }],
    },
  };
  const receipt = requestReceipt(ticket, 'workspace');
  const before = {
    id: 'before',
    role: 'assistant',
    text: 'Choose a laptop.',
    createdAt: '2026-11-01T12:04:00Z',
  };
  const after = {
    id: 'after',
    role: 'user',
    text: 'What happens next?',
    createdAt: '2026-11-01T12:06:00Z',
  };
  const messages = insertRequestReceipt([before, after], receipt);
  assert.deepEqual(
    messages.map((message) => message.id),
    ['before', receipt.id, 'after'],
  );
  assert.equal(insertRequestReceipt(messages, receipt).length, 3);
  assert.equal(receipt.formReceipt.requestId, 'request');
  assert.equal(receipt.formReceipt.answers[0].value, 'Mac');
  assert.equal(receipt.kind, 'request-confirmation');
  assert.match(receipt.text, /has been submitted/);
  const plain = requestReceipt({ ...ticket, formSubmission: undefined }, 'workspace');
  assert.match(plain.text, /\/workspace\/workspace\/requests\/request/);
});
