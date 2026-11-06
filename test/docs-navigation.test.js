import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  documentationPages,
  documentationCategories,
  documentationAnchorTarget,
  rewriteDocumentationLinks,
} from '../src/services/public/docsNavigation.js';
const page = (id) => documentationPages.find((item) => item.id === id);

test('documentation separates user workflows and optional local SDK reference', async () => {
  const guide = await readFile(new URL('../docs/workflows.md', import.meta.url), 'utf8');
  const sdk = await readFile(new URL('../api/sdk/workflows/README.md', import.meta.url), 'utf8');
  assert.match(guide, /no SDK installation is needed/);
  assert.ok(!guide.includes('npm install'));
  assert.match(sdk, /no separate SDK installation is needed/);
  assert.match(sdk, /npm install \/absolute\/path\/to\/agentzuno\/api\/sdk\/workflows/);
  assert.equal(page('workflow-sdk').slug, 'workflows');
  assert.equal(page('workflow-development').slug, 'workflow-sdk');
  assert.equal(page('workflow-sdk').category, 'Use AgentZuno');
  assert.equal(page('workflow-development').category, 'Developer and operations');
  assert.equal(
    new Set(documentationPages.map((item) => item.slug)).size,
    documentationPages.length,
  );
  assert.ok(documentationPages.every((item) => documentationCategories.includes(item.category)));
});

test('moved documentation links and legacy anchors keep working', () => {
  const links = rewriteDocumentationLinks(
    '[Workflow](../../../docs/workflows.md) [SDK](../api/sdk/workflows/README.md) [Types](../api/sdk/workflows/index.d.ts) [Dev](local-development.md)',
  );
  assert.equal(
    links,
    '[Workflow](/docs/workflows) [SDK](/docs/workflow-sdk) [Types](/docs/workflow-reference) [Dev](/docs/local-development)',
  );
  assert.equal(
    documentationAnchorTarget(page('workflow-sdk'), '#runtime-and-operational-limits'),
    '/docs/workflow-sdk#runtime-and-operational-limits',
  );
  assert.equal(
    documentationAnchorTarget(page('workflow-sdk'), '#workflow-sdk-3'),
    '/docs/workflow-sdk#build-test-and-publish',
  );
  assert.equal(
    documentationAnchorTarget(page('roles-and-features'), '#set-up-the-workspace-admin'),
    '/docs/getting-started#set-up-your-workspace',
  );
  assert.equal(
    documentationAnchorTarget(page('roles-and-features'), '#roles-and-features-6'),
    '/docs/roles#approval-permission',
  );
  assert.equal(
    documentationAnchorTarget(page('getting-started'), '#local-node-development'),
    '/docs/local-development#local-node-development',
  );
  assert.equal(documentationAnchorTarget(page('knowledge'), '#organize-bases-and-topics'), null);
  assert.equal(documentationAnchorTarget(page('knowledge'), '#%malformed'), null);
});
