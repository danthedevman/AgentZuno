import { test, expect } from '@playwright/test';
import { toTypeScript } from '../../api/sdk/workflows/index.js';

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
  await expect(page.getByRole('button', { name: 'Review Changes', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeVisible();
  const baseLookup = page.getByRole('combobox', { name: 'Knowledge Base', exact: true });
  await expect(baseLookup).toHaveValue('');
  await expect(page.getByRole('navigation', { name: 'Article location' })).not.toContainText(
    'ServiceNow',
  );
  await baseLookup.click();
  await page.getByRole('option').first().click();
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
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
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
    await page.setViewportSize({ width: 1536, height: 1100 });
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
  await expect(
    page.locator('.data-record-topbar').getByRole('button', { name: 'Save', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('complementary', { name: 'Task properties and activity' })
      .getByRole('textbox', { name: 'Due Date', exact: true }),
  ).toBeVisible();
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
  await page.getByRole('textbox', { name: 'Due Date', exact: true }).fill('2027-03-12');
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
  await page.getByRole('tab', { name: 'Comments', exact: true }).click();
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
  ).toBeAttached();
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Comments', exact: true })).toBeVisible();
  const sheet = page.locator('.data-record-timeline .record-property-sheet');
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Due Date', exact: true })).toHaveValue(
    '2027-03-12',
  );
  await page.getByRole('textbox', { name: 'Due Date', exact: true }).fill('2027-03-15');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveCount(0);
  expect((await (await page.request.get(`/api/helpdesk/tasks/${task.id}`)).json()).dueDate).toBe(
    '2027-03-15',
  );
  await page.getByRole('tab', { name: 'Comments', exact: true }).click();
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
  await expect(name.locator('..').locator('.field-requirement')).toHaveText('Required');
  await expect(description.locator('..').locator('.field-requirement')).toHaveText('Optional');
  const labelBottom = await name.evaluate((input) => {
    const label = input.closest('label');
    const text = [...label.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
    );
    const range = document.createRange();
    range.selectNodeContents(text);
    return range.getBoundingClientRect().bottom;
  });
  expect((await name.boundingBox()).y).toBeGreaterThan(labelBottom);
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
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Comments', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Work Notes', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Comments', exact: true }).click();
  await expect(page.getByText('No comments yet', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Related records', exact: true }).click();
  await expect(page.getByText('No related records linked.', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Related records', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Work Notes', exact: true })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Work Note', exact: true })).toBeVisible();
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Form', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Record properties', exact: true });
  await expect(panel.getByText(applicationName, { exact: true })).toBeVisible();
  await expect(panel.locator('.record-description-block')).toHaveCount(0);
  const descriptionLabel = panel.locator('.record-value dt').filter({ hasText: /^Description$/ });
  const nameLabel = panel.locator('.record-value dt').filter({ hasText: /^Name$/ });
  expect(
    Math.abs((await descriptionLabel.boundingBox()).x - (await nameLabel.boundingBox()).x),
  ).toBeLessThan(1);
  await page
    .locator('.data-record-topbar')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Updated service application');
  await expect(
    page.locator('.data-record-topbar').getByRole('button', { name: 'Save Record', exact: true }),
  ).toBeInViewport();
  await page
    .locator('.data-record-topbar')
    .getByRole('button', { name: 'Save Record', exact: true })
    .click();
  await expect(
    page.locator('.data-record-topbar').getByRole('button', { name: 'Edit', exact: true }),
  ).toBeVisible();
  const updated = await (
    await page.request.get(`/api/helpdesk/data/tables/ref-application/records/${record.id}`)
  ).json();
  expect(updated.values.description).toBe('Updated service application');
  const vendorName = `Example vendor ${testInfo.project.name}`;
  const vendorResponse = await page.request.post('/api/helpdesk/data/tables/ref-vendor/records', {
    data: { values: { name: vendorName } },
  });
  expect(vendorResponse.ok(), await vendorResponse.text()).toBe(true);
  const vendor = await vendorResponse.json();
  const linked = await page.request.put(
    `/api/helpdesk/data/tables/ref-application/records/${record.id}`,
    {
      data: { version: updated.version, values: { ...updated.values, vendor: vendor.id } },
    },
  );
  expect(linked.ok(), await linked.text()).toBe(true);
  await page.reload();
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Activity', exact: true }).click();
  const activityPanel = page.getByRole('complementary', { name: 'Record activity', exact: true });
  await activityPanel.getByRole('tab', { name: 'Related records', exact: true }).click();
  const vendorLink = activityPanel.getByRole('link', { name: vendorName, exact: true });
  await expect(vendorLink).toBeVisible();
  await expect(vendorLink).toHaveAttribute(
    'href',
    new RegExp(`/data/ref-vendor/records/${vendor.id}$`),
  );
  await expect(activityPanel.getByRole('textbox', { name: 'Comment', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('data-record-details.png') });
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
  await page.goto('/docs/workflows');
  await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
  await expect(page.locator('.docs-content')).toContainText('no SDK installation is needed');
  await expect(page.locator('.docs-content')).not.toContainText('npm install');
  await page
    .locator('.docs-content')
    .getByRole('link', { name: 'Workflow SDK', exact: true })
    .click();
  await expect(page).toHaveURL(/\/docs\/workflow-sdk$/);
  await expect(page.locator('.docs-content')).toContainText(
    'npm install /absolute/path/to/agentzuno/api/sdk/workflows',
  );
  await page.goto('/docs/workflows#runtime-and-operational-limits');
  await expect(page).toHaveURL(/\/docs\/workflow-sdk#runtime-and-operational-limits$/);
  await expect
    .poll(() =>
      page
        .locator('#runtime-and-operational-limits')
        .evaluate((element) => element.getBoundingClientRect().top),
    )
    .toBeLessThan(200);
  await page.goto('/docs#roles-and-features-6');
  await expect(page).toHaveURL(/\/docs\/roles#approval-permission$/);
  await expect
    .poll(() =>
      page
        .locator('#approval-permission')
        .evaluate((element) => element.getBoundingClientRect().top),
    )
    .toBeLessThan(200);
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
  isMobile,
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
  await page.route(`**/api/helpdesk/article-attachment-list/${id}`, (route) =>
    route.fulfill({
      json: [{ id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Access guide.pdf', size: 2048 }],
    }),
  );
  await page.goto(`/workspace/${workspace}/articles/${id}/read`);
  await expect(
    page.getByRole('heading', { name: 'Request application access', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Submit your access request through the portal.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Article sections' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Attachments', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Access guide.pdf' })).toHaveAttribute(
    'href',
    new RegExp('article=' + id),
  );
  const bodyBounds = await page.locator('.article-reader-content').boundingBox();
  const attachmentsBounds = await page.locator('.article-reader-attachments').boundingBox();
  if (isMobile)
    expect(attachmentsBounds.y).toBeGreaterThanOrEqual(bodyBounds.y + bodyBounds.height);
  else {
    expect(attachmentsBounds.x).toBeGreaterThan(bodyBounds.x + bodyBounds.width);
    expect(attachmentsBounds.width).toBeLessThan(bodyBounds.width);
  }
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
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancel).toBeFocused();
  const actions = await dialog.locator('.confirmation-actions').boundingBox();
  const confirm = await dialog
    .getByRole('button', { name: 'Remove Invitation', exact: true })
    .boundingBox();
  expect(Math.abs(confirm.x + confirm.width - actions.x - actions.width)).toBeLessThan(2);
  await cancel.click();
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
  await expect(page.getByRole('heading', { name: 'User Details' })).toHaveCount(0);
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
  await expect
    .poll(async () =>
      page.getByRole('textbox', { name: 'Name', exact: true }).evaluate((input) => {
        const label = input.closest('label');
        const text = [...label.childNodes].find(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
        );
        const range = document.createRange();
        range.selectNodeContents(text);
        const textBox = range.getBoundingClientRect();
        const markerBox = label.querySelector('.field-requirement').getBoundingClientRect();
        return Math.abs(markerBox.y + markerBox.height / 2 - textBox.y - textBox.height / 2);
      }),
    )
    .toBeLessThan(2);
  await page.getByRole('switch', { name: 'Assignment Group', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Routing Instructions' })).toHaveCount(0);
  await page.getByRole('switch', { name: 'Assignment Group', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Routing Instructions' })
    .fill('Route appropriate requests here.');
  await expect(page.locator('.record-section > h2')).toHaveText(['Group Settings', 'Membership']);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).not.toHaveURL(/\/new$/);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page.locator('.record-property-sheet').getByRole('textbox')).toHaveCount(0);
  await expect(page.getByText('Route appropriate requests here.', { exact: true })).toBeVisible();
});

test('dashboards share compact refresh and secondary links and chat reports load', async ({
  page,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  await page.goto('/workspace/222222222222222222222222/my-work');
  await expect(page.locator('.dashboard-toolbar-actions > .list-action-menu')).toHaveCount(1);
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

test('knowledge folders support three topic levels, inline articles, and resizing', async ({
  page,
  isMobile,
}, testInfo) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const create = async (url, data) => {
    const response = await page.request.post(url, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const suffix = testInfo.project.name;
  const base = await create('/api/records/knowledge-base', {
    name: `Explorer ${suffix}`,
    description: 'Useful instructions.',
  });
  const root = await create('/api/topics', {
    name: 'Apps',
    description: '',
    articleIds: [],
    knowledgeBaseId: base.id,
  });
  const child = await create('/api/topics', {
    name: 'Salesforce',
    description: '',
    articleIds: [],
    knowledgeBaseId: base.id,
    parentTopicId: root.id,
  });
  const leaf = await create('/api/topics', {
    name: 'Access',
    description: '',
    articleIds: [],
    knowledgeBaseId: base.id,
    parentTopicId: child.id,
  });
  const article = await create('/api/articles', {
    title: `Explorer guide ${suffix}`,
    body: '<p>Request access through the portal.</p>',
    status: 'Published',
    knowledgeBaseId: base.id,
    topicIds: [leaf.id],
  });
  await page.goto('/workspace/222222222222222222222222/knowledge');
  const tree = page.getByRole('tree', { name: 'Knowledge folders' });
  await tree.getByRole('button', { name: `Expand Explorer ${suffix}`, exact: true }).click();
  await tree.getByRole('link', { name: `Explorer ${suffix}`, exact: true }).click();
  await expect(page.locator('.help-center-topic-card').first()).toBeVisible();
  expect(
    (await page.locator('.help-center-topic-card').first().boundingBox()).height,
  ).toBeLessThanOrEqual(110);
  if (isMobile) await page.getByRole('button', { name: 'Browse knowledge folders' }).click();
  await tree.getByRole('link', { name: 'Apps', exact: true }).click();
  const pill = page
    .locator('.knowledge-subtopic-pill')
    .getByRole('link', { name: 'Salesforce', exact: true });
  await expect(pill).toBeVisible();
  await pill.click();
  await expect(page).toHaveURL(new RegExp('topic=' + child.id));
  if (isMobile) await page.getByRole('button', { name: 'Browse knowledge folders' }).click();
  const folder = tree.getByRole('treeitem', { name: 'Access', exact: true });
  await folder.getByRole('link', { name: 'Access', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Access', exact: true })).toBeVisible();
  await expect(page.getByText('Author: Alex Morgan', { exact: true })).toBeVisible();
  await expect(page.locator('.knowledge-article-metadata time')).toContainText('Updated');
  await expect(page.getByRole('button', { name: 'Knowledge actions' })).toHaveCount(0);
  await expect(folder.getByRole('button', { name: 'Add topic in Access' })).toHaveCount(0);
  if (isMobile) await page.getByRole('button', { name: 'Browse knowledge folders' }).click();
  await tree
    .getByRole('treeitem', { name: `Explorer guide ${suffix}`, exact: true })
    .getByRole('link', { name: `Explorer guide ${suffix}`, exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: `Explorer guide ${suffix}`, exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Request access through the portal.', { exact: true })).toBeVisible();
  const editArticle = page.getByRole('link', { name: 'Edit Article', exact: true });
  const topbar = page.locator('.knowledge-article-topbar');
  await expect(topbar.getByRole('navigation', { name: 'Knowledge location' })).toBeVisible();
  await expect(editArticle).toBeVisible();
  const editBounds = await editArticle.boundingBox();
  const crumbBounds = await topbar.getByRole('navigation').boundingBox();
  expect(
    Math.abs(editBounds.y + editBounds.height / 2 - crumbBounds.y - crumbBounds.height / 2),
  ).toBeLessThan(2);
  if (isMobile) await page.getByRole('button', { name: 'Browse knowledge folders' }).click();
  const articleRow = tree.getByRole('treeitem', { name: `Explorer guide ${suffix}`, exact: true });
  if (!isMobile) await articleRow.hover();
  const overlay = articleRow.locator('.knowledge-article-overlay');
  await expect(overlay).toHaveCSS('opacity', '1');
  await expect(
    overlay.getByRole('link', { name: `Edit Explorer guide ${suffix}`, exact: true }),
  ).toHaveAttribute('href', new RegExp(`/articles/${article.id}/edit$`));
  if (isMobile) await page.getByRole('button', { name: 'Browse knowledge folders' }).click();

  await expect(page.getByRole('tablist', { name: 'Article sections' })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp('article=' + article.id));
  if (!isMobile) {
    const divider = page.getByRole('separator', { name: 'Resize knowledge folders' });
    const before = Number(await divider.getAttribute('aria-valuenow'));
    await divider.focus();
    await page.keyboard.press('ArrowRight');
    expect(Number(await divider.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
    const stored = await divider.getAttribute('aria-valuenow');
    await page.reload();
    await expect(divider).toHaveAttribute('aria-valuenow', stored);
  }
});

test('workflow and My Requests tables consolidate details into two columns', async ({ page }) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  await page.goto('/workspace/222222222222222222222222/workflows');
  await expect(
    page
      .getByRole('group', { name: 'Workflows view', exact: true })
      .getByRole('button', { name: 'Cards', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('group', { name: 'Workflows view', exact: true })
    .getByRole('button', { name: 'Table', exact: true })
    .click();
  await expect(page.locator('.record-table thead th:not(.record-selection-column)')).toHaveText([
    /Workflow/,
    /Updated/,
  ]);
  await expect(page.locator('.record-row-details .activity-status').first()).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole('group', { name: 'Workflows view', exact: true })
      .getByRole('button', { name: 'Table', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/workspace/222222222222222222222222/requests');
  const card = page.locator('.record-card').first();
  await expect(card).toBeVisible();
  expect(
    await card.evaluate((node) => {
      const style = getComputedStyle(node);
      return (
        style.borderLeftWidth === style.borderTopWidth &&
        style.borderLeftColor === style.borderTopColor
      );
    }),
  ).toBe(true);
  const sortControl = page.getByRole('combobox', { name: 'Sort records by', exact: true });
  await expect(sortControl).toHaveAttribute('title', /Updated/);
  await sortControl.click();
  await page.getByRole('option', { name: 'Request', exact: true }).click();
  await expect(sortControl).toHaveAttribute('aria-description', 'Request');
  await expect(sortControl).toHaveAttribute('aria-expanded', 'false');
  await sortControl.click();
  await page.getByRole('option', { name: 'Request, ascending', exact: true }).click();
  await sortControl.click();
  await expect(
    page.getByRole('option', { name: 'Request, descending', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  const filter = page.getByRole('combobox', { name: 'Request status filter', exact: true });
  await expect(filter).toHaveAttribute('title', /All Statuses/);
  expect((await filter.boundingBox()).width).toBeLessThanOrEqual(40);
  await page
    .getByRole('group', { name: 'My Requests view', exact: true })
    .getByRole('button', { name: 'Table', exact: true })
    .click();
  await expect(sortControl).toBeHidden();
  const views = page.getByRole('group', { name: 'My Requests view', exact: true });
  await expect(views).not.toContainText('Cards');
  await expect(views).not.toContainText('Table');
  await expect(page.locator('.record-table thead th:not(.record-selection-column)')).toHaveText([
    /Request/,
    /Updated/,
  ]);
  await expect(page.locator('.record-row-details .activity-status').first()).toBeVisible();
});

test('workflow visuals let an admin replace an unavailable assignment group', async ({
  page,
  isMobile,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const id = 'cccccccccccccccccccccccc';
  const workflow = {
    id,
    name: 'Repair assignment',
    version: 1,
    enabled: false,
    department: 'general',
    keywords: ['repair'],
    action: 'route',
    queueName: 'Missing Support',
    updatedAt: '2026-11-05T12:00:00.000Z',
    definition: {
      version: 1,
      name: 'Repair assignment',
      trigger: { department: 'general', phrases: ['repair'] },
      steps: [{ id: 'route-request', action: 'route', params: { queueName: 'Missing Support' } }],
    },
  };
  await page.route('**/api/helpdesk/workflows', (route) => route.fulfill({ json: [workflow] }));
  await page.route(`**/api/helpdesk/workflows/${id}/view`, (route) =>
    route.fulfill({ json: { workflowId: id, chatId: null } }),
  );
  await page.route('**/api/helpdesk/queues?reference=1*', (route) =>
    route.fulfill({ json: [{ id: 'dddddddddddddddddddddddd', name: 'Existing Support' }] }),
  );
  await page.route(`**/api/helpdesk/workflows/${id}`, async (route) => {
    const input = route.request().postDataJSON();
    await route.fulfill({ json: { ...workflow, ...input, id, version: 2 } });
  });
  await page.goto(`/workspace/222222222222222222222222/workflows/${id}/edit`);
  if (isMobile)
    await page
      .getByRole('group', { name: 'Conversation view' })
      .getByRole('button', { name: 'Workflow', exact: true })
      .click();
  const group = page.getByRole('combobox', { name: 'Assignment Group', exact: true });
  await expect(group).toBeEnabled();
  await expect(page.getByText(/Missing Support.*unavailable/)).toBeVisible();
  await group.click();
  const saved = page.waitForRequest(
    (request) =>
      request.method() === 'PUT' && request.url().endsWith(`/api/helpdesk/workflows/${id}`),
  );
  await page.getByRole('option', { name: /Existing Support/ }).click();
  expect((await saved).postDataJSON().queueName).toBe('Existing Support');
  await expect(page.locator('.workflow-assignment-group')).toContainText('Existing Support');
});

test('article review appears only for actual chat changes and shows before-after sections', async ({
  page,
  isMobile,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const baseResponse = await page.request.post('/api/records/knowledge-base', {
    data: { name: 'Existing article review fixture', description: '' },
  });
  const base = await baseResponse.json();
  const topicResponse = await page.request.post('/api/topics', {
    data: { name: 'Review fixture', description: '', articleIds: [], knowledgeBaseId: base.id },
  });
  const topic = await topicResponse.json();
  const articleResponse = await page.request.post('/api/articles', {
    data: {
      title: 'Original fixture',
      body: '<p>Original content.</p>',
      status: 'Draft',
      knowledgeBaseId: base.id,
      topicIds: [topic.id],
    },
  });
  const article = await articleResponse.json();
  let candidate = { title: article.title, body: article.body };
  await page.route('**/api/helpdesk/article-conversations/eeeeeeeeeeeeeeeeeeeeeeee', (route) =>
    route.fulfill({
      json: {
        id: 'eeeeeeeeeeeeeeeeeeeeeeee',
        status: 'complete',
        candidate,
        messages: [{ id: 'response-1', role: 'assistant', text: 'Article proposal ready.' }],
      },
    }),
  );
  await page.route('**/api/helpdesk/article-proposals', (route) =>
    route.fulfill({
      json: {
        id: 'ffffffffffffffffffffffff',
        status: 'pending',
        draft: route.request().postDataJSON().draft,
      },
    }),
  );
  await page.goto(
    `/workspace/222222222222222222222222/articles/${article.id}/edit?chat=eeeeeeeeeeeeeeeeeeeeeeee`,
  );
  if (isMobile)
    await page
      .getByRole('group', { name: 'Conversation view' })
      .getByRole('button', { name: 'Article', exact: true })
      .click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review Changes', exact: true })).toHaveCount(0);
  candidate = { title: 'Request access', body: '<p>Use the portal.</p>' };
  await page.reload();
  await expect(page.getByRole('button', { name: 'Review Changes', exact: true })).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Title diff', exact: true })).toContainText(
    'Request access',
  );
  await expect(page.getByRole('region', { name: 'Body diff', exact: true })).toContainText(
    'Use the portal.',
  );
  await expect(page.locator('.change-review-line.is-add')).not.toHaveCount(0);
  const save = page.getByRole('button', { name: 'Save', exact: true });
  const publish = page.getByRole('button', { name: 'Publish', exact: true });
  await expect(save).toBeDisabled();
  await expect(publish).toBeDisabled();
  let previewWrites = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/article-proposals'))
      previewWrites++;
  });
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const standalone = await popup;
  await expect(standalone).toHaveURL(/\/preview\/.*\/proposals\/ffffffffffffffffffffffff$/);
  await standalone.close();
  expect(previewWrites).toBe(0);
  await expect(page.locator('.article-review-bar')).toHaveCSS('position', 'sticky');
  await page.getByRole('button', { name: 'Approve Changes', exact: true }).click();
  await expect(save).toBeEnabled();
  await expect(publish).toBeEnabled();
  await page.getByRole('tab', { name: 'Editor', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('An additional unreviewed edit');
  await expect(save).toBeDisabled();
  await expect(publish).toBeDisabled();
});

test('public header follows scroll direction without shifting the page', async ({
  page,
  isMobile,
}) => {
  await page.goto('/docs/workflow-reference');
  const header = page.locator('.docs-header');
  await expect(header).toBeVisible();
  await expect(header).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(header).toHaveCSS('border-bottom-width', '0px');
  const initial = await page
    .locator('#docs-main')
    .evaluate((node) => node.getBoundingClientRect().top + window.scrollY);
  await page.evaluate(() => window.scrollTo(0, 650));
  await expect(header).toHaveClass(/is-scroll-hidden/);
  expect((await header.boundingBox()).y + (await header.boundingBox()).height).toBeLessThanOrEqual(
    1,
  );
  // Small individual movements must accumulate rather than being discarded each frame.
  for (let index = 0; index < 8; index++) {
    await page.evaluate(() => window.scrollBy(0, -3));
    await page.waitForTimeout(25);
  }
  await expect(header).not.toHaveClass(/is-scroll-hidden/);
  await page.waitForTimeout(300);
  expect((await header.boundingBox()).y).toBeCloseTo(0, 0);
  expect(
    await page
      .locator('#docs-main')
      .evaluate((node) => node.getBoundingClientRect().top + window.scrollY),
  ).toBeCloseTo(initial, 0);
  if (isMobile) {
    const toolbar = await page.locator('.docs-mobile-toolbar').boundingBox();
    const bounds = await header.boundingBox();
    expect(toolbar.y).toBeCloseTo(bounds.height, 0);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(header).not.toHaveClass(/is-scroll-hidden/);
});

test('knowledge bases use card skeletons and stacked modal fields', async ({ page, isMobile }) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/helpdesk/knowledge-directory?**', async (route) => {
    const selected = new URL(route.request().url()).searchParams.get('base');
    if (!selected) await pending;
    const node = {
      id: '333333333333333333333333',
      baseId: '333333333333333333333333',
      type: 'base',
      name: 'Product Guides',
      description: 'Practical product documentation.',
      depth: 0,
    };
    await route.fulfill({
      json: {
        rows: selected ? [] : [node],
        total: selected ? 0 : 1,
        folder: selected ? { ...node, path: [node], ancestors: [node.id] } : null,
        hasNext: false,
      },
    });
  });
  await page.goto('/workspace/222222222222222222222222/knowledge?tab=bases');
  await expect(page).toHaveURL(/\/knowledge$/);
  await expect(page.getByRole('tablist', { name: 'Knowledge sections' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Knowledge', exact: true })).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Browse knowledge folders' }).click();
  await expect(page.getByRole('status', { name: 'Loading knowledge bases' })).toBeVisible();
  await expect(page.locator('.help-center-base-skeleton')).toHaveCount(6);
  await expect(page.locator('.help-center-hero')).toHaveCount(0);
  release();
  await expect(page.getByRole('status', { name: 'Loading knowledge bases' })).toHaveCount(0);
  const title = page.locator('.help-center-base-title').filter({ hasText: 'Product Guides' });
  await expect(title).toBeVisible();
  await expect(page.getByText('Practical product documentation.', { exact: true })).toBeVisible();
  await expect(page.locator('.help-center-base-card ul')).toHaveCount(0);
  await expect(page.locator('.help-center-browse')).toHaveCount(0);
  await expect(title).toHaveCSS('color', 'rgb(129, 140, 248)');
  await page.locator('.help-center-add-card').click();
  const dialog = page.getByRole('dialog', { name: 'Add Knowledge Base' });
  const input = dialog.locator('input[name="name"]');
  const description = dialog.locator('textarea[name="description"]');
  await expect(input).toBeVisible();
  const inputBounds = await input.boundingBox();
  const descriptionBounds = await description.boundingBox();
  expect(descriptionBounds.x).toBeCloseTo(inputBounds.x, 0);
  const formBounds = await dialog.locator('form').boundingBox();
  expect(inputBounds.width).toBeGreaterThan(formBounds.width * 0.95);
  expect(
    await input
      .locator('..')
      .evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length),
  ).toBe(1);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const card = page.locator('.help-center-base-card').filter({ has: title });
  await card.scrollIntoViewIfNeeded();
  const cardBounds = await card.boundingBox();
  const chevronBounds = await card.locator('.help-center-card-chevron').boundingBox();
  expect(chevronBounds.y + chevronBounds.height / 2).toBeCloseTo(
    cardBounds.y + cardBounds.height / 2,
    0,
  );
  expect(cardBounds.x + cardBounds.width - chevronBounds.x - chevronBounds.width).toBeCloseTo(
    25,
    0,
  );
  await page.route('**/api/helpdesk/knowledge-bases/333333333333333333333333', (route) =>
    route.fulfill({ json: { id: '333333333333333333333333', name: 'Product Guides' } }),
  );
  await card.click({ position: { x: cardBounds.width / 2, y: cardBounds.height - 12 } });
  await expect(page).toHaveURL(/knowledge\?base=333333333333333333333333$/);
});

test('Dashboard is the shared landing page with role-appropriate work views', async ({
  page,
  isMobile,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  let role = 'admin';
  await page.route('**/api/helpdesk/access', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...(await response.json()), role, canImpersonate: false } });
  });
  for (role of ['admin', 'agent', 'user', 'read-only']) {
    await page.goto('/workspace/222222222222222222222222');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    if (['admin', 'agent'].includes(role)) {
      await expect(page.getByRole('navigation', { name: 'Dashboard views' })).toBeVisible();
      if (!isMobile) {
        const search = await page
          .getByRole('searchbox', { name: 'Search Assigned Requests', exact: true })
          .boundingBox();
        const sort = await page.getByRole('combobox', { name: 'Sort records by' }).boundingBox();
        expect(Math.abs(search.y + search.height / 2 - sort.y - sort.height / 2)).toBeLessThan(2);
      }
      await page.getByRole('button', { name: 'My Requests', exact: true }).click();
      await expect(
        page.getByRole('group', { name: 'My Requests view', exact: true }),
      ).toBeVisible();
    } else await expect(page.getByRole('navigation', { name: 'Dashboard views' })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: /Select all.*records/ })).toHaveCount(0);
  }
});

test('knowledge explorer creates bases and topics and opens articles in the selected folder', async ({
  page,
  isMobile,
}, testInfo) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  await page.goto('/workspace/222222222222222222222222/knowledge');
  const explorer = page.getByRole('navigation', { name: 'Knowledge explorer' });
  const toolbar = explorer.getByRole('group', { name: 'Knowledge folder actions' });
  await expect(toolbar).toHaveCSS('opacity', '1');
  for (const label of [
    'Add Knowledge Base',
    'Refresh knowledge folders',
    'Collapse all knowledge folders',
  ]) {
    await expect(toolbar.getByRole('button', { name: label, exact: true })).toHaveAttribute(
      'data-tooltip',
      label,
    );
  }
  const refresh = toolbar.getByRole('button', { name: 'Refresh knowledge folders' });
  if (!isMobile) await refresh.hover();
  else await refresh.focus();
  await expect(page.getByRole('tooltip')).toHaveText('Refresh knowledge folders');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Knowledge actions' })).toHaveCount(0);
  const header = await page.locator('.knowledge-workspace-heading').boundingBox();
  const main = await page.locator('.workspace-main').boundingBox();
  expect(Math.abs(header.x - main.x)).toBeLessThan(2);
  expect(Math.abs(header.width - main.width)).toBeLessThan(2);
  await explorer.getByRole('button', { name: 'Add Knowledge Base', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Add Knowledge Base' });
  const name = `Inline guides ${testInfo.project.name}`;
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const baseId = new URL(page.url()).searchParams.get('base');
  expect(baseId).toMatch(/^[a-f0-9]{24}$/);
  if (isMobile) await page.getByRole('button', { name: 'Browse knowledge folders' }).click();
  if (!isMobile) await explorer.getByRole('treeitem', { name, exact: true }).hover();
  const emptyBase = explorer
    .getByRole('treeitem', { name, exact: true })
    .locator('.knowledge-tree-empty');
  const emptyBaseAction = emptyBase.getByRole('button', { name: 'Add Topic', exact: true });
  await expect(emptyBase.getByText('No topics', { exact: true })).toBeAttached();
  if (!isMobile) {
    await toolbar.getByRole('button', { name: 'Refresh knowledge folders' }).focus();
    await toolbar.hover();
    await expect(emptyBaseAction).toHaveCSS('opacity', '0');
    await emptyBase.hover();
    await expect(emptyBaseAction).toHaveCSS('opacity', '1');
    await toolbar.hover();
    await emptyBaseAction.focus();
  }
  await expect(emptyBaseAction).toHaveCSS('opacity', '1');
  const editBase = explorer.getByRole('button', { name: `Edit ${name}`, exact: true });
  await editBase.click();
  dialog = page.getByRole('complementary', { name: 'Edit Knowledge Base', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(name);
  await dialog.getByRole('button', { name: 'Close editor' }).click();
  await expect(dialog).toHaveCount(0);
  const createTopic = explorer.getByRole('button', { name: `Add topic in ${name}`, exact: true });
  const actionBounds = await createTopic.boundingBox();
  expect(actionBounds.height).toBeLessThanOrEqual(28);
  expect(actionBounds.width).toBeLessThanOrEqual(28);
  await createTopic.click();
  dialog = page.getByRole('dialog', { name: 'Add Topic', exact: true });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Getting started');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const topicId = new URL(page.url()).searchParams.get('topic');
  expect(topicId).toMatch(/^[a-f0-9]{24}$/);
  if (isMobile) await page.getByRole('button', { name: 'Browse knowledge folders' }).click();
  if (!isMobile)
    await explorer.getByRole('treeitem', { name: 'Getting started', exact: true }).hover();
  await explorer.getByRole('button', { name: 'Edit Getting started', exact: true }).click();
  dialog = page.getByRole('complementary', { name: 'Edit Topic', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
    'Getting started',
  );
  await dialog.getByRole('button', { name: 'Close editor' }).click();
  const emptyTopic = explorer
    .getByRole('treeitem', { name: 'Getting started', exact: true })
    .locator('.knowledge-tree-empty');
  const emptyTopicAction = emptyTopic.getByRole('link', { name: 'Add Article', exact: true });
  await expect(emptyTopicAction).toHaveAttribute(
    'href',
    new RegExp(`base=${baseId}&topic=${topicId}$`),
  );
  if (!isMobile) await emptyTopic.hover();
  await expect(emptyTopicAction).toHaveCSS('opacity', '1');
  const folderSearch = explorer.getByRole('searchbox', { name: 'Search knowledge folders' });
  await folderSearch.fill('Getting started');
  await expect(explorer.getByRole('treeitem', { name, exact: true })).toHaveCount(0);
  await expect(explorer.locator('[role=treeitem][aria-selected=true]')).toBeVisible();
  await expect(explorer.locator('[role=treeitem][aria-selected=true]')).toHaveAttribute(
    'aria-label',
    'Getting started',
  );
  await folderSearch.clear();
  await expect(explorer.getByRole('treeitem', { name, exact: true })).toBeVisible();
  if (!isMobile)
    await explorer.getByRole('treeitem', { name: 'Getting started', exact: true }).hover();
  const link = explorer.getByRole('link', { name: 'Add article in Getting started', exact: true });
  await expect(link).toHaveAttribute('href', new RegExp(`base=${baseId}.*topic=${topicId}`));
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/create/article\\?base=${baseId}&topic=${topicId}`));
  if (isMobile)
    await page
      .getByRole('group', { name: 'Conversation view' })
      .getByRole('button', { name: 'Article', exact: true })
      .click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `Remove ${name}`, exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Remove Getting started', exact: true }),
  ).toBeVisible();
});

test('table selection stays in tables and record headers keep their actions visible', async ({
  page,
}, testInfo) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const created = await page.request.post('/api/helpdesk/data/tables/ref-application/records', {
    data: { values: { name: `Selection fixture ${testInfo.project.name}` } },
  });
  expect(created.ok(), await created.text()).toBe(true);
  for (const route of ['inbox', 'workflows', 'data/ref-application']) {
    await page.goto(`/workspace/222222222222222222222222/${route}`);
    await page.getByRole('button', { name: 'Cards', exact: true }).click();
    await expect(page.locator('.record-card').first()).toBeVisible();
    await expect(page.locator('.record-card input[type="checkbox"]')).toHaveCount(0);
    if (route === 'inbox')
      expect(
        (await page.locator('.record-card .inbox-table-subject > a').first().boundingBox()).width,
      ).toBeGreaterThan(150);
    await page.getByRole('button', { name: 'Table', exact: true }).click();
    await expect(page.locator('.record-table input[type="checkbox"]').first()).toBeVisible();
    await page.locator('.record-table input[type="checkbox"]').first().check();
    await expect(page.locator('.record-table tbody input[type="checkbox"]').first()).toBeChecked();
    const selection = page.locator('.record-selection-toolbar');
    await expect(selection).toBeVisible();
    const selectionBounds = await selection.boundingBox();
    const checkboxBounds = await page
      .locator('.record-table thead input[type="checkbox"]')
      .first()
      .boundingBox();
    expect(selectionBounds.y + selectionBounds.height).toBeLessThanOrEqual(checkboxBounds.y);
    await page.getByRole('button', { name: 'Cards', exact: true }).click();
    await expect(selection).not.toBeVisible();
  }
  await page.goto('/workspace/222222222222222222222222/data/ref-application/records/new');
  const button = page.getByRole('button', { name: 'Save Record', exact: true });
  await expect(button).toBeVisible();
  const crumbs = page.getByRole('navigation', { name: 'Page location', exact: true });
  const crumbsBounds = await crumbs.boundingBox();
  const saveBounds = await button.boundingBox();
  expect(
    Math.abs(crumbsBounds.y + crumbsBounds.height / 2 - saveBounds.y - saveBounds.height / 2),
  ).toBeLessThan(2);
  expect(saveBounds.x).toBeGreaterThan(crumbsBounds.x + crumbsBounds.width);
  await expect(page.locator('.data-record-panel-heading, .data-record-panel-toolbar')).toHaveCount(
    0,
  );
  await expect(page.getByRole('navigation', { name: 'Record sections', exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator('.data-record-properties h2')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Add Record', exact: true })).not.toBeInViewport();
  const panel = page.getByRole('region', { name: 'Record properties', exact: true });
  await expect(panel).toBeVisible();
  const panelBounds = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(Math.abs(panelBounds.y + panelBounds.height - viewport.height)).toBeLessThan(2);
  await panel.locator('.data-record-properties-scroll').evaluate((element) => {
    element.scrollTop = 1000;
  });
  await expect(button).toBeInViewport();
  if (testInfo.project.name === 'desktop') {
    const divider = page.getByRole('separator', { name: 'Resize record panels' });
    await divider.focus();
    await page.keyboard.press('ArrowRight');
    expect((await panel.boundingBox()).width).toBeGreaterThan(panelBounds.width);
    const activityPanel = page.getByRole('complementary', { name: 'Record activity', exact: true });
    expect((await panel.boundingBox()).x).toBeLessThan((await activityPanel.boundingBox()).x);
    await page.keyboard.press('Home');
    expect((await activityPanel.boundingBox()).width).toBeLessThanOrEqual(641);
    await page.keyboard.press('End');
    expect((await activityPanel.boundingBox()).width).toBeGreaterThanOrEqual(319);
  } else {
    await page.getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(panel).not.toBeVisible();
    await page.getByRole('button', { name: 'Form', exact: true }).click();
    await expect(button).toBeInViewport();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('data-record-workbench.png') });
});

test('untouched workflow drafts submit prompts without invalid trigger placeholders', async ({
  page,
  isMobile,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const id = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  await page.route('**/api/helpdesk/workflows', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: [
          {
            id,
            name: 'Untitled Workflow',
            enabled: false,
            isAuthoringDraft: true,
            definition: null,
            source: '',
            keywords: [],
            department: 'general',
            queueName: '',
            action: 'route',
            version: 1,
          },
        ],
      });
    return route.continue();
  });
  await page.route(`**/api/helpdesk/workflows/${id}/view`, (route) =>
    route.fulfill({ json: { workflowId: id, chatId: null } }),
  );
  let submitted;
  await page.route('**/api/helpdesk/workflow-conversations', async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 400, json: { error: 'Prompt accepted by the fixture' } });
  });
  await page.goto(`/workspace/222222222222222222222222/workflows/${id}/edit`);
  if (isMobile)
    await page
      .getByRole('group', { name: 'Conversation view', exact: true })
      .getByRole('button', { name: 'Chat', exact: true })
      .click();
  await expect(page.getByText('Choose 1–10 trigger phrases.', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Your workflow will appear here as you build it with the Admin agent.'),
  ).toBeAttached();
  const composer = page.locator('.builder-chat-composer textarea');
  await composer.fill('Create an AI tool registration form that writes to Test Records.');
  await page.locator('.builder-chat-composer button[type="submit"]').click();
  await expect.poll(() => submitted?.text).toContain('AI tool registration');
  expect(submitted.definition).toBeUndefined();
  expect(submitted.source).toBeUndefined();
});

test('source-managed records direct editing to the original record', async ({ page }) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  for (const table of ['ref-workflow', 'ref-user']) {
    const response = await page.request.get(`/api/helpdesk/data/tables/${table}/records?list=1`);
    expect(response.ok(), await response.text()).toBe(true);
    const result = await response.json();
    const record = result.rows[0];
    expect(record).toBeTruthy();
    await page.goto(`/workspace/222222222222222222222222/data/${table}/records/${record.id}`);
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeDisabled();
    const explanation = page.getByLabel('Why editing is unavailable', { exact: true });
    await explanation.focus();
    await expect(page.getByRole('tooltip')).toHaveText('Edit on the original record.');
    await expect(page.getByRole('link', { name: /Open Original Record/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Record', exact: true })).toHaveCount(0);
  }
});

test('General base edits in a right panel and cannot be deleted', async ({ page, isMobile }) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  await page.goto('/workspace/222222222222222222222222/knowledge');
  const explorer = page.getByRole('navigation', { name: 'Knowledge explorer' });
  const general = explorer.getByRole('treeitem', { name: 'General', exact: true });
  if (!isMobile) await general.hover();
  await general.getByRole('button', { name: 'Edit General', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Edit Knowledge Base', exact: true });
  await expect(panel).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('combobox', { name: 'Knowledge access' })).toBeDisabled();
  await panel
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Guidance for everyone in this workspace.');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel).toHaveCount(0);
});

test('report selectors stay aligned across reports and chat cards open a record', async ({
  page,
  isMobile,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  let position;
  for (const report of ['team', 'workflows', 'agents', 'chats']) {
    await page.goto(`/workspace/222222222222222222222222/reports?report=${report}&days=7`);
    await expect(
      page.getByRole('link', { name: 'Connect an AI Provider', exact: true }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const selector = page.getByRole('combobox', { name: 'Report', exact: true });
    await expect(selector).toBeVisible();
    const bounds = await selector.boundingBox();
    if (position) {
      expect(Math.abs(bounds.x - position.x)).toBeLessThan(2);
      expect(Math.abs(bounds.y - position.y)).toBeLessThan(2);
    }
    position = bounds;
  }
  await page.getByRole('button', { name: 'Cards', exact: true }).click();
  const card = page.locator('.record-card').first();
  await expect(card).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(/\/reports\/chats\/[a-f0-9]{24}\?days=7$/);
  await expect(page.getByRole('heading', { name: 'Chat Record', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.chat-report-metadata')).toContainText('Portal');
  await page.getByRole('link', { name: 'Chat Activity', exact: true }).click();
  await expect(page).toHaveURL(/report=chats&days=7/);
});

test('README shows fictional IT chat cards and a populated workflow audit', async ({
  page,
  isMobile,
}) => {
  test.skip(!process.env.UPDATE_README_SCREENSHOTS || isMobile);
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  await page.goto('/workspace/222222222222222222222222/reports?report=chats');
  await page.getByRole('button', { name: 'Cards', exact: true }).click();
  await page
    .getByRole('searchbox', { name: 'Search Workspace Chats', exact: true })
    .fill('IT demo:');
  await expect(page.locator('.record-card')).toHaveCount(3);
  await expect(
    page.getByRole('link', { name: 'IT demo: Register an AI tool', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: 'public/help/readme-chat-activity-dark.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.goto(
    '/workspace/222222222222222222222222/reports/audit/44444444-4444-4444-8444-444444444444',
  );
  await expect(page.getByRole('heading', { name: 'Audit Record', exact: true })).toBeVisible();
  await expect(page.locator('.audit-record-details')).toContainText('createDataRecord');
  await expect(page.locator('.record-card').first()).toBeVisible();
  await expect(page.getByText('Record JSON', { exact: true })).toBeInViewport();
  expect((await page.locator('.workspace-sidebar').boundingBox()).height).toBe(1400);
  await page.screenshot({
    path: 'public/help/readme-workflow-audit-dark.png',
    fullPage: false,
    animations: 'disabled',
  });
  const create = async (url, data) => {
    const response = await page.request.post(url, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const base = await create('/api/records/knowledge-base', {
    name: 'IT Service Desk',
    description: 'Guides for secure access, devices, and everyday IT support.',
  });
  const topics = [];
  for (const name of ['Apps and Access', 'Devices', 'Security'])
    topics.push(
      await create('/api/topics', {
        name,
        description: '',
        articleIds: [],
        knowledgeBaseId: base.id,
      }),
    );
  const examples = [
    {
      title: 'Request access to a business app',
      topic: topics[0],
      body: '<p>Ask Zuno for access to the application you need. Include your team, the requested role, and your business reason.</p><h2>Approval and fulfillment</h2><p>Your manager reviews the request before IT provisions access. Track updates in the request conversation.</p>',
    },
    {
      title: 'Set up your new laptop',
      topic: topics[1],
      body: '<p>Connect to your home or office network and sign in with your workspace account.</p><h2>First-day checklist</h2><ul><li>Install operating system updates.</li><li>Register multifactor authentication.</li><li>Confirm disk encryption is enabled.</li><li>Install approved applications through IT.</li></ul>',
    },
    {
      title: 'Connect to the company VPN',
      topic: topics[2],
      body: '<p>Use the VPN to reach internal company systems when working away from the office.</p><h2>Before you begin</h2><ul><li>Use a company-managed laptop with current security updates.</li><li>Have your multifactor authentication device ready.</li></ul><h2>Connect securely</h2><ol><li>Open your approved VPN client.</li><li>Select the company connection and sign in with your workspace account.</li><li>Approve the multifactor prompt you initiated.</li><li>Wait for Connected before opening an internal application.</li></ol><h2>If you cannot connect</h2><p>Check your internet connection and restart the VPN client. If the problem continues, ask Zuno to open an IT support request. Include the error message and time of the failed attempt. Never share passwords or verification codes.</p>',
    },
  ];
  let article;
  for (const example of examples)
    article = await create('/api/articles', {
      title: example.title,
      body: example.body,
      status: 'Published',
      knowledgeBaseId: base.id,
      topicIds: [example.topic.id],
    });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    `/workspace/222222222222222222222222/knowledge?base=${base.id}&topic=${topics[2].id}&article=${article.id}`,
  );
  await expect(
    page.getByRole('heading', { name: 'Connect to the company VPN', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('treeitem', { name: 'Security', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: 'public/help/readme-knowledge-dark.png',
    fullPage: false,
    animations: 'disabled',
  });
});

test('empty knowledge folders can be deleted from their editor after typed confirmation', async ({
  page,
  isMobile,
}, testInfo) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const name = `Temporary guides ${testInfo.project.name}`;
  const created = await page.request.post('/api/records/knowledge-base', {
    data: { name, description: '' },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const base = await created.json();
  await page.goto('/workspace/222222222222222222222222/knowledge');
  const folder = page.getByRole('treeitem', { name, exact: true });
  if (!isMobile) await folder.hover();
  await folder.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Edit Knowledge Base', exact: true });
  await panel.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete Knowledge Base', exact: true });
  await expect(confirmation.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
  const confirmationInput = confirmation.getByRole('textbox', {
    name: 'Confirmation name',
    exact: true,
  });
  const inputBounds = await confirmationInput.boundingBox();
  const formBounds = await confirmation.locator('form').boundingBox();
  expect(Math.abs(inputBounds.width - formBounds.width)).toBeLessThan(2);
  expect(inputBounds.height).toBeGreaterThanOrEqual(44);
  const labelBottom = await confirmationInput.evaluate((input) => {
    const label = input.closest('label');
    const text = [...label.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
    );
    const range = document.createRange();
    range.selectNodeContents(text);
    return range.getBoundingClientRect().bottom;
  });
  expect(inputBounds.y).toBeGreaterThan(labelBottom);
  await expect(confirmationInput).toHaveCSS('border-radius', '8px');
  await confirmationInput.fill(`${name} wrong`);
  await expect(confirmation.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
  const cancelBounds = await confirmation
    .getByRole('button', { name: 'Cancel', exact: true })
    .boundingBox();
  const deleteBounds = await confirmation
    .getByRole('button', { name: 'Delete', exact: true })
    .boundingBox();
  expect(Math.abs(cancelBounds.y - deleteBounds.y)).toBeLessThan(2);
  expect(deleteBounds.x).toBeGreaterThan(cancelBounds.x);
  expect(
    Math.abs(deleteBounds.x + deleteBounds.width - formBounds.x - formBounds.width),
  ).toBeLessThan(2);
  await page.screenshot({
    path: testInfo.outputPath('delete-confirmation-dark.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(panel).toBeVisible();
  await page.evaluate(() => localStorage.setItem('agentzuno-theme', 'light'));
  await page.reload();
  if (!isMobile) await folder.hover();
  await folder.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
  await panel.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(confirmationInput).toHaveValue('');
  await expect(confirmation.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
  await expect(confirmationInput).toHaveCSS('border-radius', '8px');
  await page.screenshot({
    path: testInfo.outputPath('delete-confirmation-light.png'),
    animations: 'disabled',
  });
  await confirmation.getByRole('textbox', { name: 'Confirmation name' }).fill(name);
  await confirmation.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(folder).toHaveCount(0);
  const deleted = await page.request.get(`/api/records/knowledge-base/${base.id}`);
  expect(deleted.status()).toBe(404);
});

test('workflow Settings danger zone uses default-on preservation choices and typed confirmation', async ({
  page,
  isMobile,
}, testInfo) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const queueName = `Workflow deletion group ${testInfo.project.name}`;
  const group = await page.request.post('/api/helpdesk/groups', {
    data: {
      name: queueName,
      description: '',
      routingInstructions: '',
      userIds: [],
      active: true,
      assignmentEnabled: true,
      approvalEnabled: true,
    },
  });
  expect(group.ok(), await group.text()).toBe(true);
  const name = `Disposable Workflow ${testInfo.project.name}`;
  const created = await page.request.post('/api/helpdesk/workflows', {
    data: {
      name,
      department: 'it',
      keywords: [],
      action: 'route',
      queueName,
      enabled: false,
      intent: 'draft',
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const workflow = await created.json();
  await page.goto(`/workspace/222222222222222222222222/workflows/${workflow.id}/edit`);
  if (isMobile)
    await page
      .getByRole('group', { name: 'Conversation view' })
      .getByRole('button', { name: 'Workflow', exact: true })
      .click();
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  const danger = page.getByRole('region', { name: 'Danger Zone', exact: true });
  const requests = danger.getByRole('switch', { name: 'Preserve existing requests', exact: true });
  const history = danger.getByRole('switch', { name: 'Preserve workflow history', exact: true });
  await expect(requests).toHaveAttribute('aria-checked', 'true');
  await expect(history).toHaveAttribute('aria-checked', 'true');
  await requests.click();
  await history.click();
  await danger.getByRole('button', { name: 'Delete Workflow', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete Workflow', exact: true });
  await expect(confirmation).toContainText('Workflow runs and saved versions will be deleted.');
  await expect(confirmation).toContainText('their tasks, and request attachments will be deleted.');
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(
    (await (await page.request.get('/api/helpdesk/workflows')).json()).some(
      (row) => row.id === workflow.id,
    ),
  ).toBe(true);
  await requests.click();
  await history.click();
  await danger.getByRole('button', { name: 'Delete Workflow', exact: true }).click();
  await expect(confirmation).toContainText('Existing requests and their tasks will be kept.');
  await expect(confirmation).toContainText('Workflow runs and saved versions will be kept.');
  await expect(
    confirmation.getByRole('button', { name: 'Delete Workflow', exact: true }),
  ).toBeDisabled();
  await confirmation.getByRole('textbox', { name: 'Confirmation name', exact: true }).fill(name);
  const deleted = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      response.url().endsWith(`/api/helpdesk/workflows/${workflow.id}`),
  );
  await confirmation.getByRole('button', { name: 'Delete Workflow', exact: true }).click();
  const response = await deleted;
  expect(response.ok(), await response.text()).toBe(true);
  expect(response.request().postDataJSON()).toMatchObject({
    confirmed: true,
    preserveRequests: true,
    preserveHistory: true,
    name,
    version: workflow.version,
  });
  await expect(page).toHaveURL(/\/workflows$/);
  await expect(page.getByText('Workflow deleted.', { exact: true })).toBeVisible();
  expect(
    (await (await page.request.get('/api/helpdesk/workflows')).json()).some(
      (row) => row.id === workflow.id,
    ),
  ).toBe(false);
});

test('workflow routing waits for a group and draft saves stay separate from publication', async ({
  page,
  isMobile,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const id = 'abababababababababababab';
  let workflow = {
    id,
    name: 'Access request',
    version: 1,
    enabled: true,
    department: 'general',
    keywords: [],
    action: 'route',
    queueName: 'Support',
    definition: {
      version: 1,
      name: 'Access request',
      trigger: { department: 'general', phrases: [] },
      steps: [
        {
          id: 'review',
          action: 'approval',
          params: { target: 'group', groupId: 'acacacacacacacacacacacac', reason: 'Review access' },
        },
        { id: 'route-request', action: 'route', params: { queueName: 'Support' } },
      ],
      form: {
        title: 'Access request',
        fields: [
          {
            id: 'type',
            label: 'Access type',
            type: 'select',
            required: true,
            options: ['New', 'Change'],
          },
        ],
      },
    },
  };
  const saves = [];
  let rejectSave = false;
  await page.route('**/api/helpdesk/approval-groups?*', (route) =>
    route.fulfill({ json: [{ id: 'acacacacacacacacacacacac', name: 'Access Review' }] }),
  );
  await page.route('**/api/helpdesk/workflows', (route) => route.fulfill({ json: [workflow] }));
  await page.route(`**/api/helpdesk/workflows/${id}/view`, (route) =>
    route.fulfill({ json: { workflowId: id, chatId: null } }),
  );
  await page.route('**/api/helpdesk/queues?*', (route) =>
    route.fulfill({ json: [{ id: 'support', name: 'Support' }] }),
  );
  await page.route(`**/api/helpdesk/workflows/${id}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    const body = route.request().postDataJSON();
    saves.push(body);
    if (rejectSave)
      return route.fulfill({
        status: 400,
        json: { error: 'Draft save unavailable. Please retry.' },
      });
    workflow = { ...workflow, ...body, enabled: true, version: workflow.version + 1, id };
    await route.fulfill({ json: workflow });
  });
  await page.addInitScript(() => localStorage.setItem('agentzuno-theme', 'light'));
  await page.goto(`/workspace/222222222222222222222222/workflows/${id}/edit`);
  if (isMobile)
    await page
      .getByRole('group', { name: 'Conversation view', exact: true })
      .getByRole('button', { name: 'Workflow', exact: true })
      .click();
  const originalUrl = page.url();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Access Review', exact: true }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/users\/groups\/acacacacacacacacacacacac$/);
  await popup.close();
  expect(page.url()).toBe(originalUrl);
  const zoom = page.getByRole('button', { name: 'Zoom in', exact: true });
  await expect(zoom).toHaveCSS('width', '28px');
  await zoom.click();
  await expect(page.getByRole('status', { name: 'Zoom level' })).toContainText('125%');
  expect(
    await page
      .locator('.chat-panel-toolbar')
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).not.toBe('rgb(0, 0, 0)');
  await expect(page.getByRole('button', { name: 'Publish Changes', exact: true })).toHaveCSS(
    'font-size',
    '14px',
  );
  await page.getByRole('tab', { name: 'Form', exact: true }).click();
  await page.getByRole('button', { name: 'Add Routing Rule', exact: true }).click();
  await expect(
    page.getByText('Select a group for each routing rule to save this draft.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish Changes', exact: true })).toBeDisabled();
  await page.waitForTimeout(1200);
  expect(saves).toHaveLength(0);
  const group = page.getByRole('combobox', { name: 'Assignment Group', exact: true });
  await group.fill('Support');
  await page.getByRole('option', { name: 'Support', exact: true }).click();
  await expect.poll(() => saves.length).toBe(1);
  await expect(page.getByRole('status').filter({ hasText: 'Draft Saved' })).toBeVisible();
  expect(saves[0].intent).toBe('draft');
  expect(saves[0].definition.routing[0].queueName).toBe('Support');
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect.poll(() => saves.length).toBe(2);
  await expect(page.getByText('Workflow draft saved.', { exact: true })).toBeVisible();
  expect(saves[1].intent).toBe('draft');
  await expect(page.getByRole('button', { name: 'Unpublish', exact: true })).toBeVisible();
  rejectSave = true;
  await page
    .getByRole('textbox', { name: 'Workflow Name', exact: true })
    .fill('Updated access request');
  await expect(page.locator('.workflow-save-status')).toContainText(
    'Draft save unavailable. Please retry.',
  );
  await expect(
    page.locator('.toast-message').filter({ hasText: 'Draft save unavailable' }),
  ).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Workflow Name', exact: true })).toHaveValue(
    'Updated access request',
  );
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect(
    page.getByText('Draft save unavailable. Please retry.', { exact: true }),
  ).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('generated workflows save their first draft and retain the flow during AI updates', async ({
  page,
  isMobile,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const id = 'adadadadadadadadadadadad';
  const chatId = 'aeaeaeaeaeaeaeaeaeaeaeae';
  let definition = {
    version: 1,
    name: 'Register an AI tool',
    trigger: { phrases: [] },
    steps: [{ id: 'route-request', action: 'route', params: { queueName: 'Support' } }],
  };
  let complete = false;
  let workflow = {
    id,
    name: 'Untitled Workflow',
    isAuthoringDraft: true,
    definition: null,
    source: '',
    enabled: false,
    version: 1,
    department: 'general',
    keywords: [],
    action: 'route',
    queueName: '',
  };
  const saves = [];
  await page.route('**/api/helpdesk/workflows', (route) => route.fulfill({ json: [workflow] }));
  await page.route(`**/api/helpdesk/workflows/${id}/view`, (route) =>
    route.fulfill({ json: { workflowId: id, chatId } }),
  );
  await page.route(`**/api/helpdesk/workflows/${id}`, async (route) => {
    const body = route.request().postDataJSON();
    saves.push(body);
    workflow = { ...workflow, ...body, id, version: workflow.version + 1, isAuthoringDraft: false };
    await route.fulfill({ json: workflow });
  });
  await page.route(`**/api/helpdesk/workflow-conversations/${chatId}`, (route) =>
    route.fulfill({
      json: {
        id: chatId,
        status: complete ? 'complete' : 'responding',
        messages: [],
        ...(complete ? { definition, typescript: toTypeScript(definition) } : {}),
      },
    }),
  );
  await page.route(`**/api/helpdesk/workflow-conversations/${chatId}/messages`, (route) => {
    complete = false;
    return route.fulfill({ json: { id: chatId } });
  });
  await page.goto(`/workspace/222222222222222222222222/workflows/new?draft=${id}&chat=${chatId}`);
  if (isMobile)
    await page
      .getByRole('group', { name: 'Conversation view', exact: true })
      .getByRole('button', { name: 'Workflow', exact: true })
      .click();
  const skeleton = page.getByRole('status', { name: 'Updating workflow flow' });
  await expect(
    page.getByText('Your workflow will appear here as you build it with the Admin agent.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(skeleton).toHaveCount(0);
  expect(saves).toHaveLength(0);
  complete = true;
  await expect(page.locator('.workflow-save-status')).toContainText('Draft Saved');
  expect(saves).toHaveLength(1);
  expect(saves[0].name).toBe('Register an AI tool');
  expect(saves[0].intent).toBe('draft');
  expect(saves[0].enabled).toBe(false);
  await expect(skeleton).toHaveCount(0);
  if (isMobile)
    await page
      .getByRole('group', { name: 'Conversation view', exact: true })
      .getByRole('button', { name: 'Chat', exact: true })
      .click();
  await page
    .locator('.builder-chat-composer textarea')
    .fill('Rename the workflow to Register approved AI tools');
  await page.locator('.builder-chat-composer button[type="submit"]').click();
  if (isMobile)
    await page
      .getByRole('group', { name: 'Conversation view', exact: true })
      .getByRole('button', { name: 'Workflow', exact: true })
      .click();
  await expect(skeleton).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Workflow Name', exact: true })).toHaveValue(
    'Register an AI tool',
  );
  await expect(page.locator('.workflow-node').first()).toContainText('Register an AI tool');
  definition = { ...definition, name: 'Register approved AI tools' };
  complete = true;
  await expect(page.getByRole('textbox', { name: 'Workflow Name', exact: true })).toHaveValue(
    'Register approved AI tools',
  );
  await expect.poll(() => saves.length).toBe(2);
  await expect(skeleton).toHaveCount(0);
  expect(saves[1].intent).toBe('draft');
});

test('Zuno replies start at the message top and long forms remain reachable', async ({ page }) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const id = 'afafafafafafafafafafafaf';
  const messages = [
    { id: 'earlier-question', role: 'user', text: 'I need help with access.' },
    {
      id: 'earlier-answer',
      role: 'assistant',
      text: Array(30).fill('Earlier support guidance.').join('\n\n'),
      status: 'complete',
    },
    { id: 'new-question', role: 'user', text: 'Show me the request form.' },
    {
      id: 'new-answer',
      role: 'assistant',
      text: Array(20)
        .fill('Review this guidance before completing your request below.')
        .join('\n\n'),
      status: 'complete',
    },
  ];
  let complete = false;
  await page.route(`**/api/helpdesk/support/conversations/${id}`, (route) =>
    route.fulfill({
      json: {
        id,
        status: complete ? 'complete' : 'responding',
        messages: complete
          ? messages
          : messages.map((message) =>
              message.id === 'new-answer'
                ? { ...message, text: '', status: 'responding' }
                : message,
            ),
        requests: [],
        requestForm: complete
          ? {
              offerId: '00000000-0000-4000-8000-000000000000',
              workflowId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
              workflowVersion: 1,
              title: 'IT access request',
              fields: Array.from({ length: 10 }, (_, index) => ({
                id: `detail-${index}`,
                label: `Detail ${index + 1}`,
                type: 'text',
                required: false,
              })),
            }
          : null,
      },
    }),
  );
  await page.goto(`/workspace/222222222222222222222222/chat/${id}`);
  const log = page.getByRole('log', { name: 'Chat messages' });
  const response = page.locator('[data-message-id="new-answer"]');
  await expect(response).toBeVisible();
  complete = true;
  await expect
    .poll(async () => {
      const bounds = await response.boundingBox();
      const container = await log.boundingBox();
      return Math.abs(bounds.y - container.y - 16);
    })
    .toBeLessThan(12);
  const firstField = page.getByRole('textbox', { name: 'Detail 1 Optional', exact: true });
  await firstField.scrollIntoViewIfNeeded();
  await firstField.fill('Needs access to the support tools');
  await expect(firstField).toBeInViewport();
  const submit = page.getByRole('button', { name: 'Submit Request', exact: true });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeInViewport();
  await expect(firstField).toHaveValue('Needs access to the support tools');
});

test('opening an existing workflow does not save or restore an older chat definition', async ({
  page,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const id = 'babababababababababababa';
  const chatId = 'bcbcbcbcbcbcbcbcbcbcbcbc';
  const definition = {
    version: 1,
    name: 'Saved workflow',
    trigger: { phrases: [] },
    steps: [{ id: 'route', action: 'route', params: { queueName: 'Support' } }],
  };
  let workflow = {
    id,
    name: definition.name,
    definition,
    source: toTypeScript(definition),
    enabled: false,
    version: 3,
    department: 'general',
    keywords: [],
    action: 'route',
    queueName: 'Support',
  };
  const saves = [];
  await page.route('**/api/helpdesk/workflows', (route) => route.fulfill({ json: [workflow] }));
  await page.route(`**/api/helpdesk/workflows/${id}/view`, (route) =>
    route.fulfill({ json: { workflowId: id, chatId } }),
  );
  await page.route(`**/api/helpdesk/workflow-conversations/${chatId}`, (route) =>
    route.fulfill({
      json: {
        id: chatId,
        status: 'complete',
        definition: { ...definition, name: 'Older chat definition' },
        typescript: toTypeScript({ ...definition, name: 'Older chat definition' }),
        messages: [
          {
            id: 'old-reply',
            role: 'assistant',
            text: 'Earlier workflow response',
            status: 'complete',
          },
        ],
      },
    }),
  );
  await page.route(`**/api/helpdesk/workflows/${id}`, async (route) => {
    const body = route.request().postDataJSON();
    saves.push(body);
    workflow = { ...workflow, ...body, id, version: workflow.version + 1 };
    await route.fulfill({ json: workflow });
  });
  await page.goto(`/workspace/222222222222222222222222/workflows/${id}/edit`);
  await expect(page.getByText('Earlier workflow response', { exact: true })).toBeAttached();
  await expect(page.getByRole('textbox', { name: 'Workflow Name', exact: true })).toHaveValue(
    'Saved workflow',
  );
  await page.waitForTimeout(1200);
  expect(saves).toHaveLength(0);
  await expect(page.locator('.workflow-save-status')).not.toContainText('Draft Saved');
  await page.getByRole('textbox', { name: 'Workflow Name', exact: true }).fill('Edited workflow');
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].definition.name).toBe('Edited workflow');
});

test('request Approvals tab distinguishes blocked, skipped and decided approvals', async ({
  page,
  isMobile,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const requests = await (await page.request.get('/api/helpdesk/requests')).json();
  const request = (requests.rows || requests).find((row) => row.chatId);
  await page.route(`**/api/helpdesk/requests/${request.id}/approvals`, (route) =>
    route.fulfill({
      json: [
        {
          id: 'blocked',
          target: 'Legal Review',
          status: 'blocked',
          reason: 'Review vendor access',
          explanation:
            'The requester cannot approve their own request. Choose another eligible approver.',
          revision: 2,
        },
        {
          id: 'skipped',
          target: 'Conditional review',
          status: 'skipped',
          explanation: 'Approval conditions did not match.',
        },
        {
          id: 'approved',
          target: 'Manager',
          status: 'approved',
          completedAt: '2026-11-06T12:00:00Z',
          decidedBy: 'Example Approver',
          comment: 'Access confirmed.',
        },
      ],
    }),
  );
  await page.goto(
    `/workspace/222222222222222222222222/chat/${request.chatId}?request=${request.id}`,
  );
  if (isMobile) await page.getByRole('button', { name: 'Details', exact: true }).click();
  await page.getByRole('tab', { name: 'Approvals', exact: true }).click();
  const approvals = page.getByRole('region', { name: 'Request approvals' });
  await expect(approvals.getByText('Blocked', { exact: true })).toBeVisible();
  await expect(approvals.getByText('Skipped', { exact: true })).toBeVisible();
  await expect(approvals.getByText('Approved', { exact: true })).toBeVisible();
  await expect(approvals.getByText('Access confirmed.', { exact: true })).toBeVisible();
  await expect(
    approvals.getByText(
      'The requester cannot approve their own request. Choose another eligible approver.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('workflow reference fields and their options use the full form width', async ({
  page,
  isMobile,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const id = 'bdbdbdbdbdbdbdbdbdbdbdbd';
  const definition = {
    version: 1,
    name: 'Vendor access',
    trigger: { phrases: [] },
    steps: [{ id: 'route', action: 'route', params: { queueName: 'Support' } }],
    form: {
      title: 'Vendor access',
      fields: [
        {
          id: 'application',
          label: 'Application',
          type: 'select',
          required: true,
          options: ['Vendor A', 'Vendor B'],
        },
        {
          id: 'vendor',
          label: 'Vendor profile',
          type: 'reference',
          referenceTable: 'users',
          required: false,
        },
        { id: 'reason', label: 'Business reason', type: 'textarea', required: true },
      ],
    },
  };
  const workflow = {
    id,
    name: definition.name,
    definition,
    source: toTypeScript(definition),
    version: 1,
    enabled: false,
    department: 'general',
    keywords: [],
    action: 'route',
    queueName: 'Support',
  };
  const option = {
    value: 'bebebebebebebebebebebebe',
    label: `Alex Example (${'long-address-'.repeat(10)}@example.test)`,
  };
  await page.route('**/api/helpdesk/workflows', (route) => route.fulfill({ json: [workflow] }));
  await page.route(`**/api/helpdesk/workflows/${id}/view`, (route) =>
    route.fulfill({ json: { workflowId: id, chatId: null } }),
  );
  let isDeleted = false;
  await page.route('**/api/helpdesk/data/tables/users/options', (route) =>
    route.fulfill({ json: isDeleted ? [] : [option] }),
  );
  await page.goto(`/workspace/222222222222222222222222/workflows/${id}/edit`);
  if (isMobile)
    await page
      .getByRole('group', { name: 'Conversation view', exact: true })
      .getByRole('button', { name: 'Workflow', exact: true })
      .click();
  const form = page.getByRole('region', { name: 'Vendor access', exact: true });
  for (const button of await page
    .getByRole('group', { name: 'Workflow zoom', exact: true })
    .getByRole('button')
    .all()) {
    expect((await button.boundingBox()).height).toBeLessThanOrEqual(28);
    expect((await button.boundingBox()).width).toBeLessThanOrEqual(28);
  }
  const reference = form.getByRole('combobox', { name: 'Vendor profile', exact: true });
  const control = form.locator('.multi-select-control');
  const textarea = form.getByRole('textbox', { name: /Business reason/ });
  await expect(reference).toBeVisible();
  for (const zoom of [100, 75]) {
    if (zoom === 75) await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    const referenceBounds = await control.boundingBox();
    const textareaBounds = await textarea.boundingBox();
    expect(Math.abs(referenceBounds.width - textareaBounds.width)).toBeLessThan(2);
    expect(Math.abs(referenceBounds.x - textareaBounds.x)).toBeLessThan(2);
  }
  await reference.fill('Alex');
  const list = form.getByRole('listbox', { name: 'Vendor profile', exact: true });
  await expect(list.getByRole('option', { name: option.label, exact: true })).toBeVisible();
  const dropdownBounds = await form.locator('.multi-select-options').boundingBox();
  expect(Math.abs(dropdownBounds.width - (await control.boundingBox()).width)).toBeLessThan(2);
  expect(
    await form
      .locator('.multi-select-options')
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await list.getByRole('option', { name: option.label, exact: true }).click();
  await expect(list).toHaveCount(0);
  await expect(form.locator('.selection-pill')).toContainText('Alex Example');
  isDeleted = true;
  await reference.click();
  await expect(form.getByRole('option', { name: option.label, exact: true })).toHaveCount(0);
  await expect(form.getByText('No matches found.', { exact: true })).toBeVisible();
  await expect(form.locator('.selection-pill')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('saved article preview is read-only and a disposable article publishes only after review', async ({
  page,
  isMobile,
}) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  // These records exist only in scripts/browser-test-api.mjs's disposable in-memory database.
  const create = async (url, data) => {
    const response = await page.request.post(url, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const base = await create('/api/records/knowledge-base', {
    name: `Preview test ${isMobile ? 'mobile' : 'desktop'}`,
    description: 'Disposable browser fixture',
  });
  const topic = await create('/api/topics', {
    name: 'Preview fixture',
    description: '',
    articleIds: [],
    knowledgeBaseId: base.id,
  });
  const article = await create('/api/articles', {
    title: 'Disposable preview article',
    body: '<p>Content created only for this browser test.</p>',
    status: 'Published',
    knowledgeBaseId: base.id,
    topicIds: [topic.id],
  });
  await page.goto(`/workspace/222222222222222222222222/articles/${article.id}/edit`);
  if (isMobile)
    await page
      .getByRole('group', { name: 'Conversation view' })
      .getByRole('button', { name: 'Article', exact: true })
      .click();
  let proposalWrites = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/article-proposals'))
      proposalWrites++;
  });
  await page.getByRole('tab', { name: 'Preview', exact: true }).click();
  await expect(page.locator('.article-builder-content > h1')).toHaveText(article.title);
  await expect(page.locator('.article-review-bar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review Changes', exact: true })).toHaveCount(0);
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const standalone = await popup;
  await expect(standalone).toHaveURL(new RegExp(`/preview/.*/articles/${article.id}$`));
  await expect(standalone.getByRole('heading', { name: article.title, exact: true })).toBeVisible();
  await expect(standalone.locator('.article-brand img')).toHaveAttribute(
    'src',
    /agentzuno-wordmark(?:-light)?\.svg$/,
  );
  await standalone.close();
  expect(proposalWrites).toBe(0);
  await page.getByRole('tab', { name: 'Editor', exact: true }).click();
  const title = `${article.title} reviewed`;
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await expect(page.getByRole('button', { name: 'Review Changes', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(article.title);
  await expect(page.getByRole('button', { name: 'Review Changes', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  const publish = page.getByRole('button', { name: 'Publish Changes', exact: true });
  await expect(publish).toBeDisabled();
  await page.getByRole('button', { name: 'Review Changes', exact: true }).click();
  await page.getByRole('button', { name: 'Approve Changes', exact: true }).click();
  expect((await (await page.request.get(`/api/articles/${article.id}`)).json()).title).toBe(
    article.title,
  );
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(page.getByText('Article published.', { exact: true })).toBeVisible();
  if (isMobile)
    await page
      .getByRole('group', { name: 'Conversation view' })
      .getByRole('button', { name: 'Article', exact: true })
      .click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(title);
  expect((await (await page.request.get(`/api/articles/${article.id}`)).json()).title).toBe(title);
});

test('new articles save and publish directly without a review step', async ({ page, isMobile }) => {
  await page
    .context()
    .addCookies([{ name: 'browser_test', value: '1', url: 'http://127.0.0.1:4180' }]);
  const create = async (url, data) => {
    const response = await page.request.post(url, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const base = await create('/api/records/knowledge-base', {
    name: 'New article fixture',
    description: '',
  });
  const topic = await create('/api/topics', {
    name: 'New article fixture',
    description: '',
    articleIds: [],
    knowledgeBaseId: base.id,
  });
  let proposalWrites = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/article-proposals'))
      proposalWrites++;
  });
  for (const action of ['Save', 'Publish']) {
    await page.goto(
      `/workspace/222222222222222222222222/create/article?base=${base.id}&topic=${topic.id}`,
    );
    if (isMobile)
      await page
        .getByRole('group', { name: 'Conversation view' })
        .getByRole('button', { name: 'Article', exact: true })
        .click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill(`${action} a new article`);
    await page
      .getByRole('textbox', { name: 'Body', exact: true })
      .fill('New article content created only for this test.');
    await expect(page.getByRole('button', { name: 'Review Changes', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approve Changes', exact: true })).toHaveCount(0);
    const savedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().endsWith('/api/articles'),
    );
    await page.getByRole('button', { name: action, exact: true }).click();
    const response = await savedResponse;
    expect(response.ok(), await response.text()).toBe(true);
    expect((await response.json()).status).toBe(action === 'Save' ? 'Draft' : 'Published');
    await expect(page).toHaveURL(/\/articles\/[a-f0-9]{24}\/edit$/);
  }
  expect(proposalWrites).toBe(0);
});
