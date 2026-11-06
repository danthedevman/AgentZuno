import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.browserErrors = [];
  page.on('pageerror', (error) => page.browserErrors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(page.browserErrors, 'The page must not crash during a normal journey').toEqual([]);
});

test('self-hosted startup opens Login and a setup-required response opens the database wizard', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your help desk' })).toHaveCount(0);
  await page.route('**/api/installation/database', (route) =>
    route.fulfill({
      json: { configured: false, provider: null, bundled: { mongodb: true, postgres: true } },
    }),
  );
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup\/database$/);
  await expect(page.getByRole('heading', { name: 'Choose Your Database' })).toBeVisible();
  await expect(page.getByLabel('Setup Token')).toBeVisible();
  if (process.env.UPDATE_DOCS_SCREENSHOTS && !isMobile)
    await page.screenshot({ path: 'public/help/docs-database-setup.png', fullPage: true });
});

test('New Article supports an absent article, base context, tabs and aligned conversation headers', async ({
  page,
  isMobile,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  await page.goto('/workspace/222222222222222222222222/create/article');
  const toolbar = page.locator('.chat-panel-toolbar');
  await expect(toolbar.getByRole('button', { name: 'New Chat' })).toBeVisible();
  const leftHeight = (await toolbar.boundingBox()).height;
  if (isMobile)
    await page
      .getByRole('group', { name: 'Conversation view' })
      .getByRole('button', { name: 'Article', exact: true })
      .click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeVisible();
  const baseLink = page.getByRole('link', { name: /Open .* in a new tab/ });
  await expect(baseLink).toBeVisible();
  const baseId = (await baseLink.getAttribute('href')).split('/').at(-1);
  const tabs = page.getByRole('tablist', { name: 'Article views' });
  const rightHeight = (await tabs.boundingBox()).height;
  expect(Math.abs(leftHeight - rightHeight)).toBeLessThanOrEqual(1);
  await tabs.getByRole('tab', { name: 'Attachments', exact: true }).click();
  await expect(tabs.getByRole('tab', { name: 'Attachments', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.goto(`/workspace/222222222222222222222222/create/article?base=${baseId}`);
  if (isMobile)
    await page
      .getByRole('group', { name: 'Conversation view' })
      .getByRole('button', { name: 'Article', exact: true })
      .click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Knowledge Base', exact: true })).toBeVisible();
});

test('profile avatar stays above the cover and navigation controls retain their geometry', async ({
  page,
  isMobile,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  await page.goto('/workspace/222222222222222222222222/profile');
  await expect(page.getByRole('heading', { name: 'Alex Morgan', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toHaveCount(0);
  const avatar = page.locator('.profile-identity-header > .profile-avatar');
  await avatar.scrollIntoViewIfNeeded();
  expect(
    await avatar.evaluate((element) => {
      const r = element.getBoundingClientRect();
      return !!document.elementFromPoint(r.x + r.width / 2, r.y + 8)?.closest('.profile-avatar');
    }),
    'The overlapping upper edge of the avatar must remain visible',
  ).toBe(true);
  if (isMobile) {
    const bar = page.getByRole('banner', { name: 'Mobile navigation' });
    await bar.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Collapse navigation', exact: true }),
    ).toBeHidden();
    await bar.getByRole('button', { name: 'Close navigation', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeHidden();
  } else {
    await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
    const box = await page
      .getByRole('button', { name: 'Create new item', exact: true })
      .boundingBox();
    expect(Math.abs(box.width - box.height)).toBeLessThanOrEqual(1);
    expect(box.width).toBeLessThanOrEqual(40);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('request conversations and workflow visuals render current app records', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'README screenshots use the desktop layout');
  await page.setViewportSize({ width: 1536, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const requests = await (await page.request.get('/api/helpdesk/requests')).json();
  const request = (requests.rows || requests).find(
    (item) => item.chatId && /macbook/i.test(item.title),
  );
  expect(request).toBeTruthy();
  await page.goto(
    `/workspace/222222222222222222222222/chat/${request.chatId}?request=${request.id}`,
  );
  await expect(page.locator('.request-workspace-panel')).toBeVisible();
  await expect(
    page.locator('.request-workspace-panel').getByText(request.title, { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator('.conversation-skeleton')).toHaveCount(0);
  if (process.env.UPDATE_README_SCREENSHOTS) {
    await page.screenshot({ path: 'public/help/readme-request-chat-dark.png' });
  }
  const workflows = await (await page.request.get('/api/helpdesk/workflows')).json();
  const workflow = (workflows.rows || workflows).find((item) => /laptop/i.test(item.name));
  expect(workflow).toBeTruthy();
  await page.goto(`/workspace/222222222222222222222222/workflows/${workflow.id}/edit`);
  await expect(page.getByRole('tab', { name: 'Visual', exact: true })).toBeVisible();
  await expect(page.getByText('Request Form', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.conversation-skeleton')).toHaveCount(0);
  if (process.env.UPDATE_README_SCREENSHOTS) {
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await page.screenshot({ path: 'public/help/readme-workflow-builder-dark.png' });
  }
});

test('workflow publication, approval rejection and task completion persist through the UI', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Full operator journey runs on desktop; mobile layout is covered separately');
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const workflows = await (await page.request.get('/api/helpdesk/workflows')).json();
  const workflow = (workflows.rows || workflows).find((item) => /laptop/i.test(item.name));
  await page.goto(`/workspace/222222222222222222222222/workflows/${workflow.id}/edit`);
  await page.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish Changes', exact: true })).toBeDisabled();
  const requests = await (await page.request.get('/api/helpdesk/requests')).json();
  const approval = (requests.rows || requests).find((item) =>
    /equipment purchase approval/i.test(item.title),
  );
  await page.goto(
    `/workspace/222222222222222222222222/chat/${approval.chatId}?request=${approval.id}`,
  );
  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  const comment = page.getByRole('textbox', { name: 'Rejection Comment' });
  await comment.fill('Please confirm the equipment requirements before approval.');
  // Refreshes must preserve the rejection draft until the decision is submitted.
  await expect(comment).toHaveValue('Please confirm the equipment requirements before approval.');
  await page.getByRole('button', { name: 'Confirm Rejection', exact: true }).click();
  await expect(comment).toHaveCount(0);
  const request = (requests.rows || requests).find((item) => /macbook/i.test(item.title));
  const created = await page.request.post(`/api/helpdesk/requests/${request.id}/tasks`, {
    data: { title: 'Prepare the laptop', description: 'Check the device before handoff' },
  });
  expect(created.ok()).toBe(true);
  const task = await created.json();
  await page.goto(`/workspace/222222222222222222222222/tasks/${task.id}`);
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Unsaved task title');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveCount(0);
  expect((await (await page.request.get(`/api/helpdesk/tasks/${task.id}`)).json()).title).toBe(
    'Prepare the laptop',
  );
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Prepare and verify the laptop');
  await page.getByLabel('Due Date', { exact: true }).fill('2027-03-12');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveCount(0);
  expect((await (await page.request.get(`/api/helpdesk/tasks/${task.id}`)).json()).title).toBe(
    'Prepare and verify the laptop',
  );
  await page.getByRole('button', { name: 'Close Complete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close Complete', exact: true })).toHaveCount(0);
  const saved = await (await page.request.get(`/api/helpdesk/tasks/${task.id}`)).json();
  expect(saved.status).toBe('closed');
  expect(saved.dueDate).toBe('2027-03-12');
  await page
    .getByRole('textbox', { name: 'Comment', exact: true })
    .fill('Please confirm the handoff');
  await page.getByRole('button', { name: 'Add Comment', exact: true }).click();
  await expect(page.getByText('Please confirm the handoff', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Work Notes', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Work Note', exact: true })
    .fill('Device checked by support');
  await page.getByRole('button', { name: 'Add Note', exact: true }).click();
  await expect(page.getByText('Device checked by support', { exact: true })).toBeVisible();
  await expect(page.getByText('Please confirm the handoff', { exact: true })).toHaveCount(0);
});

test('audit cleanup defaults off and requires confirmation before saving an enabled policy', async ({
  page,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  await page.goto('/workspace/222222222222222222222222/settings');
  await page.getByText('Audit', { exact: true }).click();
  const cleanup = page.getByRole('switch', { name: 'Automatic Cleanup' });
  await expect(cleanup).toHaveAttribute('aria-checked', 'false');
  await cleanup.click();
  await page.getByLabel('Retain Logs (Days)').fill('30');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Enable Audit Cleanup' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await (await page.request.get('/api/helpdesk/audit-retention')).json()).enabled).toBe(
    false,
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm Cleanup Policy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Enable Audit Cleanup' })).toHaveCount(0);
  await expect
    .poll(
      async () => (await (await page.request.get('/api/helpdesk/audit-retention')).json()).enabled,
    )
    .toBe(true);
  await cleanup.click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(
      async () => (await (await page.request.get('/api/helpdesk/audit-retention')).json()).enabled,
    )
    .toBe(false);
});

test('task property rows, due dates and activity fit both desktop and mobile', async ({
  page,
}, testInfo) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const requests = await (await page.request.get('/api/helpdesk/requests')).json();
  const request = (requests.rows || requests).find((item) => /macbook/i.test(item.title));
  const response = await page.request.post(`/api/helpdesk/requests/${request.id}/tasks`, {
    data: {
      title: 'Verify device handoff',
      description: 'Check the hardware and confirm delivery',
      dueDate: '2027-03-12',
    },
  });
  expect(response.ok()).toBe(true);
  const task = await response.json();
  await page.goto(`/workspace/222222222222222222222222/tasks/${task.id}`);
  await expect(
    page.getByRole('heading', { name: 'Verify device handoff', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Comments', exact: true })).toBeVisible();
  const sheet = page.locator('.record-property-sheet');
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel('Due Date', { exact: true })).toHaveValue('2027-03-12');
  await page.getByLabel('Due Date', { exact: true }).fill('2027-03-15');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveCount(0);
  expect((await (await page.request.get(`/api/helpdesk/tasks/${task.id}`)).json()).dueDate).toBe(
    '2027-03-15',
  );
  const commentField = page.getByRole('textbox', { name: 'Comment', exact: true });
  await commentField.fill('@Alex');
  await page.getByRole('option', { name: '@Alex Morgan', exact: true }).click();
  await expect(commentField).toHaveValue('@Alex Morgan ');
  await commentField.fill('@Alex Morgan Delivery confirmed');
  await page.getByRole('button', { name: 'Add Comment', exact: true }).click();
  await expect(page.getByText('@Alex Morgan Delivery confirmed', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('task-record.png'), fullPage: true });
  if (process.env.UPDATE_DOCS_SCREENSHOTS && testInfo.project.name === 'desktop')
    await page.screenshot({ path: 'public/help/docs-task-record-dark.png', fullPage: true });
});

test('application descriptions align with fields and empty records keep both staff activity tabs', async ({
  page,
}, testInfo) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  await page.goto('/workspace/222222222222222222222222/data/ref-application/records/new');
  const name = page.getByRole('textbox', { name: 'Name', exact: true });
  const description = page.getByRole('textbox', { name: 'Description', exact: true });
  await expect(name).toBeVisible();
  await expect(description).toBeVisible();
  expect(
    Math.abs((await name.boundingBox()).x - (await description.boundingBox()).x),
  ).toBeLessThanOrEqual(1);
  expect(
    await description.evaluate((element) => Boolean(element.closest('.record-description-block'))),
  ).toBe(false);
  const applicationName = `Support Portal ${testInfo.project.name}`;
  await name.fill(applicationName);
  await description.fill('Employee service application');
  await page.getByRole('button', { name: 'Save Record', exact: true }).click();
  await expect(page).toHaveURL(/\/data\/ref-application$/);
  const records = await (
    await page.request.get('/api/helpdesk/data/tables/ref-application/records')
  ).json();
  const record = (records.rows || records).find((item) => item.values.name === applicationName);
  expect(record).toBeTruthy();
  await page.goto(`/workspace/222222222222222222222222/data/ref-application/records/${record.id}`);
  await expect(page.getByRole('tab', { name: 'Comments', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Work Notes', exact: true })).toBeVisible();
  await expect(page.getByText('No comments yet', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Work Notes', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Work Note', exact: true })).toBeVisible();
});

test('public docs have focused routes, mobile navigation, legacy links and predictable scroll', async ({
  page,
  isMobile,
}) => {
  await page.goto('/docs');
  await expect(page.getByRole('heading', { name: 'Documentation', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign In', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Get Access', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  if (isMobile) await page.getByRole('button', { name: 'Browse Docs' }).click();
  await page
    .getByRole('navigation', { name: 'Documentation categories' })
    .getByRole('link', { name: 'Roles & Features', exact: true })
    .click();
  await expect(page).toHaveURL(/\/docs\/roles$/);
  await expect(page.getByRole('heading', { name: 'Roles & Features', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  if (!isMobile) {
    await expect(page.locator('.docs-mobile-sections')).toBeHidden();
    await expect(page.locator('.docs-page-index')).toBeVisible();
  }
  if (isMobile) await page.getByRole('button', { name: 'Browse Docs' }).click();
  const index = page.getByRole('navigation', {
    name: isMobile ? 'Jump to a section' : 'On this section',
  });
  const headingLink = index.getByRole('link').first();
  const href = await headingLink.getAttribute('href');
  await headingLink.click();
  await expect(page).toHaveURL(new RegExp(href + '$'));
  await expect
    .poll(() => page.locator(href).evaluate((element) => element.getBoundingClientRect().top))
    .toBeLessThan(200);
  await page.goto('/docs#knowledge');
  await expect(page).toHaveURL(/\/docs\/knowledge$/);
  await expect(page.getByRole('heading', { name: 'Knowledge', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.goto('/docs/requests-and-tasks');
  const screenshot = page.locator('.docs-screenshot img').first();
  await screenshot.scrollIntoViewIfNeeded();
  await expect.poll(() => screenshot.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
});

test('Slack member suggestions support reviewed bulk selection across pages', async ({ page }) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const users = Array.from({ length: 25 }, (_, i) => ({
    id: (i + 1).toString(16).padStart(24, '0'),
    name: `Person ${i + 1}`,
  }));
  const rows = users.map((user, i) => ({
    slackUserId: `U123MEMBER${i}`,
    name: user.name,
    email: `person${i}@fixture.test`,
    userId: user.id,
    status: 'Review email match',
  }));
  let applied = [];
  let applicationVersion = 1;
  const channel = () => ({
    id: 'slack',
    name: 'Slack',
    deliveryStatus: 'Ready',
    status: 'connected',
    configured: true,
    connected: true,
    callbackUrl: 'https://fixture.test/api/helpdesk/channels/oauth/callback',
    eventsUrl: 'https://fixture.test/api/helpdesk/channels/slack/events/222222222222222222222222',
    application: {
      clientId: 'fixture-client',
      hasClientSecret: true,
      hasSigningSecret: true,
      version: applicationVersion,
    },
    actions: { version: 1, items: [] },
    bot: {
      enabled: true,
      teamName: 'Fixture Team',
      teamId: 'T123FIXTURE',
      version: applied.length ? 2 : 1,
      identityBindings: applied,
    },
  });
  await page.route('**/api/helpdesk/channels', (route) => route.fulfill({ json: [channel()] }));
  await page.route('**/api/helpdesk/reference-records', (route) =>
    route.fulfill({ json: { users } }),
  );
  await page.route('**/api/helpdesk/channels/slack/users/discover', (route) =>
    route.fulfill({ json: { id: 'a'.repeat(24), version: 1, rows: rows.slice(0, 20), total: 25 } }),
  );
  await page.route('**/api/helpdesk/channels/slack/users/reviews/**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    return route.fulfill({
      json:
        params.get('selection') === 'suggested'
          ? { bindings: rows.map(({ slackUserId, userId }) => ({ slackUserId, userId })) }
          : {
              id: 'a'.repeat(24),
              version: 1,
              rows: rows.slice(
                (Number(params.get('page') || 1) - 1) * 20,
                Number(params.get('page') || 1) * 20,
              ),
              total: 25,
            },
    });
  });
  await page.route('**/api/helpdesk/channels/slack/users/apply', (route) => {
    const input = route.request().postDataJSON();
    expect(input.confirmed).toBe(true);
    applied = input.bindings;
    return route.fulfill({ json: { linked: applied.length } });
  });
  await page.route('**/api/helpdesk/channels/slack/application', (route) => {
    if (applicationVersion === 1) {
      applicationVersion = 2;
      return route.fulfill({ json: { saved: true } });
    }
    return route.fulfill({
      status: 422,
      json: { error: 'Connection details could not be saved.' },
    });
  });
  await page.goto('/workspace/222222222222222222222222/connectors/slack');
  await page.getByRole('button', { name: 'Save Connection Details', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Connection details saved.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save Connection Details', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Connection details could not be saved.' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find Slack Users', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Manage Slack Users', exact: true }).click();
  await expect(page).toHaveURL(/\/connectors\/slack\/users$/);
  await expect(
    page.getByRole('status').filter({ hasText: 'Connection details saved.' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('alert').filter({ hasText: 'Connection details could not be saved.' }),
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Slack Users', exact: true })).toBeVisible();
  await expect(page.getByText('Fixture Team', { exact: true })).toBeVisible();
  await expect(page.getByText('T123FIXTURE', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Find Slack Users', exact: true }).click();
  await expect(page.getByText('Page 1 of 2 · 25 members')).toBeVisible();
  const search = page.getByRole('searchbox', { name: 'Search Slack users' });
  await expect(search).toBeVisible();
  expect(await search.evaluate((input) => getComputedStyle(input).backgroundColor)).toBe(
    await page.locator('.workspace-shell').evaluate((shell) => {
      const probe = document.createElement('div');
      probe.style.backgroundColor = 'var(--workspace-panel)';
      shell.append(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    }),
  );
  await page.getByRole('button', { name: 'Select All Suggested Matches' }).click();
  await expect(page.getByText('25 selected across pages')).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Page 2 of 2 · 25 members')).toBeVisible();
  await page.getByRole('button', { name: 'Link Selected Users', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Link Selected Users', exact: true })
    .click();
  await expect.poll(() => applied.length).toBe(25);
});

test('Slack self-service linking requires visible review and removes the fragment token', async ({
  page,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  await page.route('**/api/helpdesk/channels/slack/link/inspect', (route) =>
    route.fulfill({
      json: {
        slackUserId: 'U123SELF',
        teamName: 'Fixture Team',
        workspaceId: '222222222222222222222222',
      },
    }),
  );
  let completed = false;
  await page.route('**/api/helpdesk/channels/slack/link/complete', (route) => {
    const input = route.request().postDataJSON();
    expect(input.confirmed).toBe(true);
    expect(input.token).toBe('b'.repeat(64));
    completed = true;
    return route.fulfill({ json: { linked: true, workspaceId: '222222222222222222222222' } });
  });
  await page.goto('/slack/link#' + 'b'.repeat(64));
  await expect(page.getByText(/Link Slack member U123SELF/)).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  expect(completed).toBe(false);
  await page.getByRole('button', { name: 'Confirm Account Link' }).click();
  await expect(page).toHaveURL(/\/workspace\/222222222222222222222222\/chat$/);
  expect(completed).toBe(true);
});

test('article citations open a standalone read-only reader and legacy channel links open portal Chat', async ({
  page,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const workspace = '222222222222222222222222';
  const id = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  await page.route('**/api/helpdesk/knowledge-center?article=*', (route) =>
    route.fulfill({
      json: {
        id,
        title: 'Request application access',
        body: '<p>Submit your access request through the portal.</p>',
      },
    }),
  );
  await page.goto(`/workspace/${workspace}/articles/${id}/read`);
  await expect(
    page.getByRole('heading', { name: 'Request application access', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Submit your access request through the portal.', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Save|Publish|Edit Article/i })).toHaveCount(0);
  await page.route(`**/api/helpdesk/support/conversations/${id}`, (route) =>
    route.fulfill({ json: { redirectTo: `/workspace/${workspace}/chat` } }),
  );
  await page.goto(`/workspace/${workspace}/chat/${id}`);
  await expect(page).toHaveURL(new RegExp(`/workspace/${workspace}/chat$`));
  await expect(page.getByRole('heading', { name: 'How can I help you?' })).toBeVisible();
});

test('pending invitations offer confirmed replacement links and confirmed removal', async ({
  page,
  isMobile,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const workspace = '222222222222222222222222';
  const invited = await page.request.post('/api/helpdesk/invitations', {
    headers: { Origin: 'http://127.0.0.1:4180', 'X-Workspace-Id': workspace },
    data: {
      email: `invite-${isMobile ? 'mobile' : 'desktop'}@fixture.test`,
      role: 'user',
      queues: [],
      canApprove: false,
      active: true,
    },
  });
  expect(invited.status()).toBe(202);
  await page.goto(`/workspace/${workspace}/users?tab=invitations`);
  await page.getByRole('button', { name: 'Generate New Link', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Generate New Link', exact: true });
  await expect(dialog).toContainText('The previous link will stop working.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByLabel('Invitation Link', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Generate New Link', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Generate New Link', exact: true });
  await dialog.getByRole('button', { name: 'Generate Link', exact: true }).click();
  await expect(page.getByLabel('Invitation Link', { exact: true })).toHaveValue(
    /\/invite#[a-f0-9]{64}$/,
  );
  await page.getByRole('button', { name: 'Remove Invitation', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Remove Invitation', exact: true });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Invitation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Invitation', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Remove Invitation', exact: true })
    .getByRole('button', { name: 'Remove Invitation', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Generate New Link', exact: true })).toHaveCount(0);
  await expect(page.getByText('Invitation removed.', { exact: true })).toBeVisible();
});

test('Add User opens a dedicated page and creates a shareable invitation', async ({
  page,
  isMobile,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  await page.goto('/workspace/222222222222222222222222/users');
  await page.getByRole('button', { name: 'Add User', exact: true }).first().click();
  await expect(page).toHaveURL(/\/users\/new$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'User Details' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Workspace Access' })).toBeVisible();
  const email = page.getByRole('textbox', { name: 'Email', exact: true });
  await email.pressSequentially(`record-${isMobile ? 'mobile' : 'desktop'}@fixture.test`);
  await expect(email).toHaveValue(`record-${isMobile ? 'mobile' : 'desktop'}@fixture.test`);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/helpdesk/invitations') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send Invitation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invitation Created' })).toBeVisible();
  await expect(page.getByLabel('Invitation Link', { exact: true })).toHaveValue(/\/invite#/);
  const invitation = await (await responsePromise).json();
  const removed = await page.request.delete(`/api/helpdesk/invitations/${invitation.id}`, {
    headers: { Origin: 'http://127.0.0.1:4180', 'X-Workspace-Id': '222222222222222222222222' },
    data: { confirmed: true, version: invitation.version || 1 },
  });
  expect(removed.ok()).toBeTruthy();
});

test('group records share ordered sections and retain typed values through field changes', async ({
  page,
  isMobile,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  await page.goto('/workspace/222222222222222222222222/users/groups/new');
  const name = `Form Layout ${isMobile ? 'Mobile' : 'Desktop'}`;
  await page.getByRole('textbox', { name: 'Name', exact: true }).pressSequentially(name);
  await page
    .getByRole('textbox', { name: 'Description', exact: true })
    .pressSequentially('A clearly organized group.');
  await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(name);
  await page.getByRole('switch', { name: 'Assignment Group', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Routing Instructions' })).toHaveCount(0);
  await page.getByRole('switch', { name: 'Assignment Group', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Routing Instructions' })
    .fill('Route appropriate requests here.');
  await expect(page.locator('.record-section > h2')).toHaveText([
    'Group Details',
    'Group Settings',
    'Membership',
  ]);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).not.toHaveURL(/\/new$/);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByText('Route appropriate requests here.', { exact: true })).toBeVisible();
});

test('dashboards share compact refresh and secondary links and chat reports load', async ({
  page,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  await page.goto('/workspace/222222222222222222222222/my-work');
  await page.getByRole('button', { name: 'Dashboard actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Open Inbox' })).toHaveAttribute(
    'href',
    /\/inbox$/,
  );
  await page.keyboard.press('Escape');
  await page.goto('/workspace/222222222222222222222222/reports?report=chats');
  await expect(page.getByText('API route not found.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Report', exact: true })).toContainText(
    'Chat Activity',
  );
  const response = await page.request.get('/api/helpdesk/report-chats?days=30', {
    headers: { 'X-Workspace-Id': '222222222222222222222222' },
  });
  expect(response.status()).toBe(200);
  await expect(
    page.locator('.dashboard-toolbar-actions').getByRole('button', { name: 'Refresh report' }),
  ).toBeVisible();
});
