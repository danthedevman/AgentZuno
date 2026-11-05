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
  await page.getByRole('button', { name: 'Close Complete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close Complete', exact: true })).toHaveCount(0);
  const saved = await (await page.request.get(`/api/helpdesk/tasks/${task.id}`)).json();
  expect(saved.status).toBe('closed');
});
