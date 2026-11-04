import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/app.js';

test('interactive demo uses real admin APIs with isolated records and blocks live credentials and writes', async () => {
  const app = createApi(),
    server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  async function call(path, method = 'GET', body, providedCookie = cookie) {
    const response = await fetch(root + '/api/demo-api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(providedCookie ? { cookie: providedCookie } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.headers.get('set-cookie'))
      cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, body: await response.json() };
  }
  try {
    const session = await call('/api/auth/session');
    assert.equal(session.status, 200, JSON.stringify(session.body));
    assert.equal(session.body.user.isInteractiveDemo, true);
    const ownCookie = cookie;
    const access = await call('/api/helpdesk/access');
    assert.equal(access.body.role, 'admin');
    const requests = await call('/api/helpdesk/my-work?list=1');
    assert.equal(requests.status, 200, JSON.stringify(requests.body));
    assert.ok(requests.body.total > 0);
    const inbox = await call('/api/helpdesk/inbox?list=1');
    assert.equal(inbox.status, 200, JSON.stringify(inbox.body));
    assert.ok(inbox.body.total > 0);
    const workflows = await call('/api/helpdesk/workflows?list=1');
    assert.equal(workflows.status, 200, JSON.stringify(workflows.body));
    assert.ok(workflows.body.rows.length > 0);
    const first = workflows.body.rows[0];
    assert.ok(!first.name.includes('Demo'));
    const second = await call('/api/auth/session', 'GET', null, '');
    const secondCookie = cookie;
    assert.notEqual(second.body.user.workspaceId, session.body.user.workspaceId);
    assert.equal((await call(`/api/helpdesk/workflows/${first.id}`)).status, 404);
    cookie = ownCookie;
    const detail = await call(`/api/helpdesk/workflows/${first.id}`);
    const draft = await call('/api/helpdesk/workflows', 'POST', {
      name: detail.body.name,
      department: detail.body.department,
      keywords: detail.body.keywords,
      action: detail.body.action,
      queueName: detail.body.queueName,
      enabled: false,
      intent: 'draft',
      source: detail.body.source,
      definition: detail.body.definition,
    });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    const auditOptions = await call(
      '/api/helpdesk/audit/workflows?q=' + encodeURIComponent(draft.body.name),
    );
    assert.ok(auditOptions.body.some((item) => item.value === draft.body.id));
    const audit = await call(
      `/api/helpdesk/audit?list=1&workflowId=${draft.body.id}&triggerType=workflow-configuration`,
    );
    assert.equal(audit.status, 200, JSON.stringify(audit.body));
    assert.ok(audit.body.total > 0);
    assert.ok(
      audit.body.rows.every(
        (item) =>
          item.workflowId === draft.body.id && item.triggerType === 'workflow-configuration',
      ),
    );
    assert.equal((await call('/api/helpdesk/audit?list=1&workflowId=invalid')).status, 400);
    assert.equal((await call('/api/helpdesk/audit?list=1&triggerType=invalid')).status, 400);
    const foreignAudit = await call(
      `/api/helpdesk/audit?list=1&workflowId=${draft.body.id}`,
      'GET',
      null,
      secondCookie,
    );
    assert.equal(foreignAudit.body.total, 0);
    cookie = ownCookie;
    assert.equal(
      (await call('/api/settings/ai', 'POST', { apiKey: 'not-a-real-key' })).status,
      403,
    );
    assert.equal((await call('/api/installation/database')).status, 403);
    const live = await fetch(root + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', referer: root + '/demo' },
      body: JSON.stringify({ email: 'blocked@example.test', password: 'Fictional-password!' }),
    });
    assert.equal(live.status, 403);
    const conversation = await call('/api/helpdesk/support/conversations', 'POST', {
      requestId: crypto.randomUUID(),
      text: 'I need a MacBook for a new engineer',
    });
    assert.ok([201, 202].includes(conversation.status), JSON.stringify(conversation.body));
    const completed = await call(`/api/helpdesk/support/conversations/${conversation.body.id}`);
    assert.equal(completed.body.status, 'complete', JSON.stringify(completed.body));
    assert.equal(completed.body.requestForm.title, 'Laptop Provisioning');
    assert.ok(completed.body.requestForm.fields.length > 0);
    const groupChat = await call('/api/helpdesk/workflow-conversations', 'POST', {
      requestId: crypto.randomUUID(),
      text: 'Create a group named App Support',
    });
    assert.equal(groupChat.status, 202, JSON.stringify(groupChat.body));
    const groupReply = await call(`/api/helpdesk/workflow-conversations/${groupChat.body.id}`);
    assert.equal(groupReply.body.status, 'complete', JSON.stringify(groupReply.body));
    assert.match(groupReply.body.messages.at(-1).text, /^Created \[App Support\]/);
    const groups = await call('/api/helpdesk/groups');
    assert.ok(groups.body.some((item) => item.name === 'App Support' && item.assignmentEnabled));
    const approvals = await call('/api/helpdesk/my-approvals?list=1');
    assert.ok(approvals.body.rows.length > 0, JSON.stringify(approvals.body));
    const [runId, stepId] = approvals.body.rows[0].id.split(':');
    const decisionPath = `/api/helpdesk/workflow-runs/${runId}/decisions`;
    assert.equal((await call(decisionPath, 'POST', { stepId, approved: false })).status, 400);
    assert.equal((await call(decisionPath, 'POST', { stepId, approved: true })).status, 200);
    assert.equal((await call('/api/helpdesk/my-approvals?list=1')).body.total, 0);
    const run = await call(
      '/api/helpdesk/workflow-runs?requestId=' + approvals.body.rows[0].requestId,
    );
    assert.equal(run.body[0].status, 'complete', JSON.stringify(run.body));
    cookie = secondCookie;
    const otherApprovals = await call('/api/helpdesk/my-approvals?list=1');
    const [otherRun, otherStep] = otherApprovals.body.rows[0].id.split(':');
    assert.equal(
      (
        await call(`/api/helpdesk/workflow-runs/${otherRun}/decisions`, 'POST', {
          stepId: otherStep,
          approved: false,
          comment: 'A replacement is not needed',
        })
      ).status,
      200,
    );
    const rejected = await call(
      '/api/helpdesk/workflow-runs?requestId=' + otherApprovals.body.rows[0].requestId,
    );
    assert.equal(
      rejected.body[0].steps.find((step) => step.id === otherStep).result.comment,
      'A replacement is not needed',
    );
    assert.equal((await call('/api/demo/reset', 'POST', {})).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await app.locals.close();
  }
});
