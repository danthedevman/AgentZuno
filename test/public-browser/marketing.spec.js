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
