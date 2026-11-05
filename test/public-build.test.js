import { documentationPages } from '../src/services/docsNavigation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const isStaticSite = (
  await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
).includes('application/ld+json');

test('production public pages contain readable HTML, unique metadata and valid structured data before JavaScript', async () => {
  for (const [path, title, heading] of [
    ...(isStaticSite
      ? [['index.html', 'AgentZuno | Open Source AI Help Desk', 'Your help deskFrom ask to done']]
      : []),
    ['docs/index.html', 'Documentation | AgentZuno', 'Documentation'],
    ...documentationPages.map((page) => [
      `docs/${page.slug}/index.html`,
      `${page.title} | AgentZuno Docs`,
      page.title,
    ]),
  ]) {
    const dom = new JSDOM(await readFile(new URL(`../dist/${path}`, import.meta.url), 'utf8'));
    const document = dom.window.document;
    assert.equal(document.title, title);
    assert.equal(document.querySelector('h1')?.textContent.trim(), heading);
    assert.ok(document.querySelector('#root').textContent.length > 1000);
    assert.ok(document.querySelector('meta[name="description"]').content.length > 80);
    assert.match(document.querySelector('link[rel="canonical"]').href, /^https:\/\//);
    assert.equal(document.querySelector('meta[name="robots"]').content, 'index,follow');
    assert.equal(
      JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent).name,
      'AgentZuno',
    );
    assert.ok(document.querySelector('meta[property="og:image"]').content.endsWith('.png'));
    dom.window.close();
  }
});
test('application shells are empty and noindex; sitemap includes only public routes', async () => {
  for (const path of [...(isStaticSite ? [] : ['index.html']), 'app.html', '404.html']) {
    const dom = new JSDOM(await readFile(new URL(`../dist/${path}`, import.meta.url), 'utf8'));
    assert.equal(dom.window.document.querySelector('#root').textContent, '');
    assert.equal(
      dom.window.document.querySelector('meta[name="robots"]').content,
      'noindex,nofollow',
    );
    dom.window.close();
  }
  const sitemap = await readFile(new URL('../dist/sitemap.xml', import.meta.url), 'utf8');
  assert.equal(
    (sitemap.match(/<url>/g) || []).length,
    documentationPages.length + (isStaticSite ? 2 : 1),
  );
  assert.ok(!/workspace|login|demo|register/.test(sitemap));
  const robots = await readFile(new URL('../dist/robots.txt', import.meta.url), 'utf8');
  assert.match(robots, /Disallow: .*workspace/);
});
