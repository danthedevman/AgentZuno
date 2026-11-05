import { publicPages as routes } from '../src/services/publicPages.js';
import { build } from 'vite';
import solid from 'vite-plugin-solid';
import { JSDOM } from 'jsdom';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const base = process.env.VITE_BASE_PATH || '/';
const isStaticSite = process.env.VITE_STATIC_SITE === 'true';
const publicRoutes = isStaticSite ? routes : routes.filter((route) => route.path);
const site = new URL(process.env.PUBLIC_SITE_URL || 'https://agentzuno.com/');
site.protocol = 'https:';
site.search = site.hash = '';
if (!site.pathname.endsWith('/')) site.pathname += '/';
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
function metadata(route) {
  const url = new URL(route.path ? `${route.path}/` : '', site).href;
  return `<title>${escape(route.title)}</title>
    <meta name="agentzuno-site-url" content="${escape(site.href)}" />
    <meta name="description" content="${escape(route.description)}" />
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="${escape(url)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="AgentZuno" />
    <meta property="og:title" content="${escape(route.title)}" />
    <meta property="og:description" content="${escape(route.description)}" />
    <meta property="og:url" content="${escape(url)}" />
    <meta property="og:image" content="${new URL('agentzuno-logo-social.png', site).href}" />
    <meta property="og:image:alt" content="AgentZuno logo" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escape(route.title)}" />
    <meta name="twitter:description" content="${escape(route.description)}" />
    <meta name="twitter:image" content="${new URL('agentzuno-logo-social.png', site).href}" />
    <meta name="twitter:image:alt" content="AgentZuno logo" />
    <script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'AgentZuno', url: site.href, applicationCategory: 'BusinessApplication', operatingSystem: 'Docker', description: routes[0].description, license: 'https://www.apache.org/licenses/LICENSE-2.0' }).replaceAll('<', '\\u003c')}</script>`;
}
await build();
const shell = await readFile('dist/index.html', 'utf8');
const privateShell = shell.replace(
  /<title>.*?<\/title>/,
  '<title>AgentZuno</title><meta name="robots" content="noindex,nofollow" />',
);
if (!isStaticSite) await writeFile('dist/index.html', privateShell);
await writeFile('dist/app.html', privateShell);
await writeFile('dist/404.html', privateShell);
await mkdir('node_modules/.cache', { recursive: true });
const temporary = await mkdtemp(resolve('node_modules/.cache/agentzuno-prerender-'));
const dom = new JSDOM('', { url: site.href });
// The shared Markdown renderer sanitizes and rewrites links using a DOM. This DOM exists only during the public-content build.
globalThis.window = dom.window;
globalThis.document = dom.window.document;
try {
  await build({
    configFile: false,
    base,
    plugins: [solid({ ssr: true })],
    build: {
      ssr: 'src/prerender.jsx',
      outDir: temporary,
      rollupOptions: { output: { entryFileNames: 'entry.mjs' } },
    },
    logLevel: 'warn',
  });
  const { renderPublicPage } = await import(pathToFileURL(join(temporary, 'entry.mjs')).href);
  for (const route of publicRoutes) {
    const html = await renderPublicPage(`${base}${route.path}`);
    if (!html.includes('<h1') || html.length < 1000)
      throw new Error(`Public route did not prerender: ${route.path || '/'}`);
    const rendered = shell
      .replace(/<title>.*?<\/title>/, metadata(route))
      .replace('<div id="root"></div>', `<div id="root">${html}</div>`);
    const directory = join('dist', route.path);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'index.html'), rendered);
    console.log(`Prerendered /${route.path || ''}`);
  }
  const blocked = [
    'workspace',
    'demo',
    'login',
    'register',
    'setup',
    'invite',
    'preview',
    'api',
    'app.html',
    '404.html',
  ];
  await writeFile(
    'dist/robots.txt',
    `User-agent: *\nAllow: ${base}\n${blocked.map((path) => `Disallow: ${base}${path}`).join('\n')}\nSitemap: ${new URL('sitemap.xml', site).href}\n`,
  );
  await writeFile(
    'dist/sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicRoutes.map((route) => `<url><loc>${escape(new URL(route.path ? `${route.path}/` : '', site).href)}</loc></url>`).join('')}</urlset>\n`,
  );
} finally {
  dom.window.close();
  delete globalThis.window;
  delete globalThis.document;
  await rm(temporary, { recursive: true, force: true });
}
