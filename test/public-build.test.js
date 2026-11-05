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
    assert.ok(
      document
        .querySelector('meta[property="og:image"]')
        .content.endsWith('/agentzuno-logo-social.png'),
    );
    assert.match(document.querySelector('meta[property="og:image"]').content, /^https:\/\//);
    assert.equal(document.querySelector('meta[property="og:image:alt"]').content, 'AgentZuno logo');
    assert.equal(document.querySelector('meta[property="og:image:width"]').content, '1200');
    assert.equal(document.querySelector('meta[property="og:image:height"]').content, '630');
    assert.equal(
      document.querySelector('meta[name="twitter:image"]').content,
      document.querySelector('meta[property="og:image"]').content,
    );
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

test('shared social logo is a public 1200 by 630 PNG', async () => {
  const image = await readFile(new URL('../dist/agentzuno-logo-social.png', import.meta.url));
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
});
