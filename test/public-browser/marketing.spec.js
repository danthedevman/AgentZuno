import { test, expect } from '@playwright/test';

test('prerendered marketing hydrates visible panels and starts their animations', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.disconnectedAnimationTargets = [];
    const Observer = window.IntersectionObserver;
    window.IntersectionObserver = class extends Observer {
      observe(element) {
        if (!element.isConnected) window.disconnectedAnimationTargets.push(element.className);
        super.observe(element);
      }
    };
    const observer = new MutationObserver(() => {
      const heading = document.querySelector('.landing-hero-copy h1');
      if (heading && !window.initialMarketingHeading) window.initialMarketingHeading = heading;
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await page.reload();
    else await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/app-ready/);
    await page.locator('.hero-demo-stack').scrollIntoViewIfNeeded();
    await expect(page.locator('.hero-employee-message')).toBeVisible();
    await expect(page.locator('.hero-agent-activity')).toBeVisible();
    expect(
      await page.evaluate(
        () => window.initialMarketingHeading === document.querySelector('.landing-hero-copy h1'),
      ),
    ).toBe(true);
    await page.getByRole('button', { name: 'Show employee request' }).click();
    await expect(page.getByRole('button', { name: 'Show workflow builder' })).toBeVisible();
    await expect(page.locator('.hero-employee-panel .hero-employee-message')).toBeVisible();
    const knowledge = page.locator('.marketing-knowledge-chat');
    await knowledge.scrollIntoViewIfNeeded();
    await expect(knowledge.getByRole('button', { name: 'Read article' })).toBeVisible({
      timeout: 10000,
    });
    await knowledge.getByRole('button', { name: 'Read article' }).click();
    await expect(knowledge.getByText('Open your device’s Wi-Fi settings')).toBeVisible();
    expect(await page.evaluate(() => window.disconnectedAnimationTargets)).toEqual([]);
    expect(errors).toEqual([]);
  }
});

test('lifecycle visuals have no numbering and respect reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.hero-conversation-visual.is-front')).toHaveClass(/is-published/);
  const lifecycle = page.locator('.request-lifecycle');
  await lifecycle.scrollIntoViewIfNeeded();
  await expect(lifecycle.locator('article')).toHaveCount(4);
  await expect(lifecycle.locator('.request-lifecycle-visual')).toHaveCount(4);
  await expect(lifecycle).not.toContainText(/0[1-4]/);
  await expect(page.getByText('Example workflow', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('lifecycle cards stack during natural scrolling and release before the next section', async ({
  page,
}) => {
  await page.goto('/');
  const cards = page.locator('.request-lifecycle article');
  const origins = await cards.evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().top + window.scrollY),
  );
  for (let index = 0; index < origins.length; index++) {
    const top = await cards.nth(index).evaluate((card) => parseFloat(getComputedStyle(card).top));
    await page.evaluate(
      (position) => window.scrollTo({ top: position, behavior: 'instant' }),
      origins[index] - top + 20,
    );
    await expect(cards.nth(index)).toHaveClass(/is-revealed/);
    const pinned = await cards.nth(index).boundingBox();
    expect(Math.abs(pinned.y - top)).toBeLessThan(2);
    if (index < 3) {
      const nextBefore = await cards.nth(index + 1).boundingBox();
      await page.mouse.wheel(0, 100);
      await expect
        .poll(() => page.evaluate(() => window.scrollY))
        .toBeGreaterThan(origins[index] - top + 80);
      const nextAfter = await cards.nth(index + 1).boundingBox();
      expect(nextAfter.y).toBeLessThan(nextBefore.y - 60);
      expect(Math.abs((await cards.nth(index).boundingBox()).y - top)).toBeLessThan(2);
    }
  }
  await page.locator('#build-workflows-title').scrollIntoViewIfNeeded();
  const lastCard = await cards.last().boundingBox();
  expect(lastCard.y + lastCard.height).toBeLessThan(
    await page
      .locator('#build-workflows-title')
      .evaluate((heading) => heading.getBoundingClientRect().top),
  );
  await page.evaluate(
    (position) => window.scrollTo({ top: position, behavior: 'instant' }),
    origins[1] - 110,
  );
  expect(await cards.nth(1).evaluate((card) => getComputedStyle(card).position)).toBe('sticky');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('hero request submission slides a full-width record over the chat', async ({
  page,
  isMobile,
}) => {
  await page.clock.install();
  await page.goto('/');
  await page.locator('.hero-demo-stack').scrollIntoViewIfNeeded();
  if (!isMobile) {
    await page.clock.runFor(1000);
    await expect
      .poll(async () =>
        Math.abs(
          (await page.locator('.landing-hero-copy').boundingBox()).y -
            (await page.locator('.hero-demo-stack').boundingBox()).y,
        ),
      )
      .toBeLessThan(2);
  }
  await page.getByRole('button', { name: 'Show employee request' }).click();
  await page.clock.runFor(10500);
  const panel = page.locator('.hero-employee-panel');
  await expect(panel.locator('.hero-form-submit')).toContainText('Request Submitted');
  await expect(panel.locator('.hero-request-details')).not.toBeVisible();
  await page.clock.runFor(3500);
  const record = panel.locator('.hero-request-details');
  await expect(record).toBeVisible();
  const width = await record.evaluate((element) => element.offsetWidth);
  const parentWidth = await panel
    .locator('.hero-request-workbench')
    .evaluate((element) => element.clientWidth);
  expect(Math.abs(width - parentWidth)).toBeLessThan(2);
  await expect(record).toContainText('REQ-000001');
});

test('workflow panels reveal together with staggered motion and coding-tool links load', async ({
  page,
}) => {
  await page.goto('/');
  const workflow = page.locator('.marketing-workflow-diagram');
  await workflow.scrollIntoViewIfNeeded();
  await expect(workflow).toHaveClass(/is-visible/);
  await expect(workflow.locator('.marketing-workflow-prompt')).toContainText(
    'Build a laptop request',
  );
  const panels = workflow.locator('li');
  await expect(panels).toHaveCount(4);
  await expect(panels.first()).toHaveCSS('animation-name', 'workflow-step-rise');
  const delays = await panels.evaluateAll((items) =>
    items.map((item) => parseFloat(getComputedStyle(item).animationDelay)),
  );
  expect(delays[0]).toBeGreaterThan(0.4);
  expect(delays[3]).toBeGreaterThan(delays[0]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(panels.first()).toHaveCSS('animation-name', 'none');
  const governance = page.locator('.marketing-governance');
  await expect(governance.locator('.marketing-feature-checklist li')).toHaveCount(6);
  await expect(governance).not.toContainText(/0[1-3]/);
  for (const [name, href] of [
    ['Cursor', 'https://cursor.com/docs/agent/overview'],
    ['GitHub Copilot', 'https://github.com/features/copilot/'],
  ]) {
    const link = page.getByRole('link', { name, exact: true });
    await expect(link).toHaveAttribute('href', href);
    expect(
      await link.locator('img').evaluate((image) => image.complete && image.naturalWidth > 0),
    ).toBe(true);
  }
  const approval = page.locator('.lifecycle-approval');
  await approval.scrollIntoViewIfNeeded();
  const positions = await page
    .locator(
      '.lifecycle-approval > span:nth-child(2), .lifecycle-workflow-trigger > span:nth-child(2)',
    )
    .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().x));
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(2);
});

test('hero demos advance only the panel currently in front', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/app-ready/);
  await page.locator('.hero-demo-stack').scrollIntoViewIfNeeded();
  await page.clock.runFor(1000);
  const builder = page.locator('.hero-conversation-visual:not(.hero-employee-panel)');
  const employee = page.locator('.hero-employee-panel');
  await expect(employee.locator('.hero-employee-message')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show employee request' }).click();
  const pausedBuilder = await builder.innerHTML();
  await page.clock.runFor(4500);
  expect(await builder.innerHTML()).toBe(pausedBuilder);
  await expect(employee.locator('.hero-employee-message')).toBeVisible();
  await page.getByRole('button', { name: 'Show workflow builder' }).click();
  const pausedEmployee = await employee.innerHTML();
  await page.clock.runFor(2000);
  expect(await employee.innerHTML()).toBe(pausedEmployee);
  await expect(builder.locator('.hero-agent-activity')).toBeVisible();
});
