import ReleaseBanner from '../../components/marketing/ReleaseBanner.jsx';
import { useScrollHeader } from '../../services/public/scrollHeader.js';
import { A, useLocation, useNavigate } from '@solidjs/router';
import { For, Show, createEffect, createSignal, onMount, onCleanup } from 'solid-js';
import {
  documentationPages,
  documentationCategories,
  documentationAnchorTarget,
  documentationPath,
  rewriteDocumentationLinks,
} from '../../services/public/docsNavigation.js';
import { publicAsset } from '../../services/public/publicAsset.js';
import ChatMarkdown from '../../components/chat/ChatMarkdown.jsx';
import CodeBlock from '../../components/CodeBlock.jsx';
import Icon from '../../components/Icon.jsx';
import gettingStartedGuide from '../../../docs/getting-started.md?raw';
import rolesGuide from '../../../docs/roles-and-features.md?raw';
import requestsGuide from '../../../docs/requests-and-tasks.md?raw';
import knowledgeGuide from '../../../docs/knowledge.md?raw';
import databaseGuide from '../../../docs/databases.md?raw';
import agentToolsGuide from '../../../docs/agent-tools.md?raw';
import integrationsGuide from '../../../docs/integrations.md?raw';
import testingGuide from '../../../docs/testing.md?raw';
import recoveryGuide from '../../../docs/recovery.md?raw';
import capacityGuide from '../../../docs/capacity.md?raw';
import deploymentGuide from '../../../docs/deployment.md?raw';
import renderGuide from '../../../docs/render.md?raw';
import awsGuide from '../../../docs/aws.md?raw';
import securityGuide from '../../../docs/security.md?raw';
import slackGuide from '../../../docs/slack.md?raw';
import workflowsGuide from '../../../docs/workflows.md?raw';
import localDevelopmentGuide from '../../../docs/local-development.md?raw';
import sdkGuide from '../../../api/sdk/workflows/README.md?raw';
import sdkTypes from '../../../api/sdk/workflows/index.d.ts?raw';

const guides = {
  'getting-started': gettingStartedGuide,
  'roles-and-features': rolesGuide,
  'requests-and-tasks': requestsGuide,
  knowledge: knowledgeGuide,
  deployment: deploymentGuide,
  render: renderGuide,
  aws: awsGuide,
  'database-setup': databaseGuide,
  'agent-tools': agentToolsGuide,
  integrations: integrationsGuide,
  slack: slackGuide,
  testing: testingGuide,
  recovery: recoveryGuide,
  capacity: capacityGuide,
  'runtime-security': securityGuide,
  'workflow-sdk': workflowsGuide,
  'workflow-development': sdkGuide,
  'local-development': localDevelopmentGuide,
};

function DocsScreenshot(props) {
  return (
    <figure class="docs-screenshot">
      <a
        href={publicAsset(props.src)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open screenshot: ${props.caption}`}
      >
        <img
          src={publicAsset(props.src)}
          alt={props.caption}
          loading="lazy"
          decoding="async"
          width="1280"
        />
      </a>
      <figcaption>{props.caption}</figcaption>
    </figure>
  );
}
export default function DocsPage() {
  let publicHeader;
  useScrollHeader(() => publicHeader);
  const location = useLocation(),
    navigate = useNavigate();
  const currentPath = () => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    const pathname = location.pathname.replace(/\/$/, '');
    return base && pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
  };
  const page = () => documentationPages.find((item) => documentationPath(item) === currentPath());
  const isOverview = () => currentPath() === '/docs';
  const [headings, setHeadings] = createSignal([]);
  const [activeHeading, setActiveHeading] = createSignal('');
  const [menuOpen, setMenuOpen] = createSignal(false);
  let content, menuButton;
  const guide = () =>
    rewriteDocumentationLinks(
      (guides[page()?.id] || '').replace(/^# [^\n]*\n/, '').replace(/!\[[^\]]*\]\([^)]*\)/g, ''),
    );
  function scrollToHeading() {
    if (!location.hash) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    let id;
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch {
      return;
    }
    const target =
      content?.querySelector(`[id="${CSS.escape(id)}"]`) ||
      headings().find((item) => item.legacyId === id)?.element;
    target?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  createEffect(() => {
    const path = location.pathname,
      hash = location.hash;
    const legacy =
      isOverview() &&
      documentationPages.find(
        (item) => hash === '#' + item.id || hash.startsWith('#' + item.id + '-'),
      );
    if (legacy) {
      navigate(documentationPath(legacy) + (hash === '#' + legacy.id ? '' : hash), {
        replace: true,
      });
      return;
    }
    const redirectedAnchor = documentationAnchorTarget(page(), hash);
    if (redirectedAnchor && redirectedAnchor !== `${currentPath()}${hash}`) {
      navigate(redirectedAnchor, { replace: true });
      return;
    }
    page();
    setMenuOpen(false);
    const frame = requestAnimationFrame(() => {
      const used = new Set();
      setHeadings(
        [...content.querySelectorAll('h2, h3')].map((element, index) => {
          const base =
            element.textContent
              .toLowerCase()
              .replace(/[^a-z0-9\s-]/g, '')
              .trim()
              .replace(/\s+/g, '-') || 'section';
          let id = base,
            suffix = 2;
          while (used.has(id)) id = `${base}-${suffix++}`;
          used.add(id);
          element.id = id;
          return {
            id,
            label: element.textContent,
            legacyId: `${page()?.id || 'overview'}-${index + 1}`,
            element,
          };
        }),
      );
      setActiveHeading(headings()[0]?.id || '');
      scrollToHeading();
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });
  createEffect(() => {
    if (!menuOpen()) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    onCleanup(() => {
      document.body.style.overflow = previous;
    });
  });
  onMount(() => {
    let frame;
    const update = () => {
      frame = undefined;
      let selected = headings()[0]?.id || '';
      for (const item of headings())
        if (item.element.getBoundingClientRect().top <= 180) selected = item.id;
      setActiveHeading(selected);
    };
    const schedule = () => {
      if (window.innerWidth > 760) setMenuOpen(false);
      if (frame === undefined) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    onCleanup(() => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame !== undefined) cancelAnimationFrame(frame);
    });
  });
  function closeMenu(event) {
    if (event.target.closest('a')) {
      setMenuOpen(false);
      menuButton?.focus();
    }
  }
  return (
    <div
      class="docs-page"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && menuOpen()) {
          setMenuOpen(false);
          menuButton?.focus();
        }
      }}
    >
      <ReleaseBanner />
      <a class="docs-skip-link" href="#docs-main">
        Skip to content
      </a>
      <header ref={publicHeader} class="docs-header scroll-public-header">
        <A href="/" class="docs-brand">
          <img
            src={publicAsset('/agentzuno-wordmark.svg')}
            alt="AgentZuno"
            width="144"
            height="36"
          />
        </A>
        <nav aria-label="Public navigation">
          <a
            href="https://github.com/danthedevman/agentzuno"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View AgentZuno on GitHub"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.8.1-.8.1-.8 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6A4.7 4.7 0 0 1 5.7 8.7c-.1-.3-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.9.1 3.2a4.7 4.7 0 0 1 1.2 3.3c0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
            </svg>
          </a>
        </nav>
      </header>
      <div class="docs-mobile-toolbar">
        <button
          ref={menuButton}
          type="button"
          aria-expanded={menuOpen()}
          aria-controls="docs-categories"
          onClick={() => setMenuOpen(!menuOpen())}
        >
          <Icon name={menuOpen() ? 'close' : 'menu-open'} />
          Browse Docs
          <Icon name="chevron-down" />
        </button>
        <span>{page()?.title || 'Overview'}</span>
      </div>
      <div class="docs-layout">
        <aside
          class="docs-navigation"
          id="docs-categories"
          classList={{ 'is-open': menuOpen() }}
          onClick={closeMenu}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setMenuOpen(false);
              menuButton?.focus();
            }
          }}
        >
          <nav aria-label="Documentation categories">
            <A href="/docs" aria-current={isOverview() ? 'page' : undefined}>
              Overview
            </A>
            <For each={documentationCategories}>
              {(category) => (
                <>
                  <strong class="docs-category-label">{category}</strong>
                  <For each={documentationPages.filter((item) => item.category === category)}>
                    {(item) => (
                      <A
                        href={documentationPath(item)}
                        aria-current={page()?.id === item.id ? 'page' : undefined}
                      >
                        {item.title}
                      </A>
                    )}
                  </For>
                </>
              )}
            </For>
          </nav>
          <nav class="docs-mobile-sections" aria-label="Jump to a section">
            <strong>On this section</strong>
            <For each={headings()}>
              {(heading) => (
                <a
                  href={'#' + heading.id}
                  aria-current={activeHeading() === heading.id ? 'location' : undefined}
                >
                  {heading.label}
                </a>
              )}
            </For>
          </nav>
        </aside>
        <main class="docs-content" id="docs-main" ref={content}>
          <h1>{page()?.title || (isOverview() ? 'Documentation' : 'Guide Not Found')}</h1>
          <Show
            when={page()}
            fallback={
              <Show
                when={isOverview()}
                fallback={<p>Choose a guide from the documentation categories.</p>}
              >
                <p>
                  Learn how to run AgentZuno, build service workflows, and help your team get work
                  done. Start with installation, then follow the guides for your role.
                </p>
                <h2>Start with your role</h2>
                <p>
                  <strong>Admins</strong> install the app, connect services, and publish workflows
                  and knowledge. <strong>Agents</strong> handle assigned requests and tasks.{' '}
                  <strong>Users</strong> ask questions and submit requests.{' '}
                  <strong>Read Only</strong> users review permitted records and reports without
                  changing them.
                </p>
                <For each={documentationCategories}>
                  {(category) => (
                    <>
                      <h2>{category}</h2>
                      <div class="docs-guide-grid">
                        <For each={documentationPages.filter((item) => item.category === category)}>
                          {(item) => (
                            <A href={documentationPath(item)}>
                              <strong>
                                {item.title}
                                <span aria-hidden="true">→</span>
                              </strong>
                              <p>{item.description}</p>
                            </A>
                          )}
                        </For>
                      </div>
                    </>
                  )}
                </For>
                <DocsScreenshot
                  src="/help/readme-my-work-dark.png"
                  caption="My Work brings assigned requests and personal workload together"
                />
              </Show>
            }
          >
            <p class="docs-guide-description">{page().description}</p>
            <Show
              when={page().id === 'type-reference'}
              fallback={<ChatMarkdown text={guide()} scrollTables externalLinksNewTab />}
            >
              <h2>Workflow types</h2>
              <p>
                Use these declarations with the workflow SDK. Start with the{' '}
                <A href="/docs/workflows">workflow guide</A> for in-app steps, the{' '}
                <A href="/docs/workflow-sdk">optional local SDK</A> for developer examples, and the{' '}
                <A href="/docs/security">sandbox boundaries</A> before adding actions.
              </p>
              <CodeBlock language="typescript" code={sdkTypes} />
            </Show>
            <Show when={page().id === 'workflow-sdk'}>
              <DocsScreenshot
                src="/help/readme-workflow-builder-dark.png"
                caption="Build and review a workflow alongside the Admin conversation"
              />
            </Show>
            <Show when={page().id === 'requests-and-tasks'}>
              <DocsScreenshot
                src="/help/readme-request-chat-dark.png"
                caption="A submitted request stays alongside its conversation"
              />
              <DocsScreenshot
                src="/help/docs-task-record-dark.png"
                caption="Task properties, due dates, Comments, and Work Notes"
              />
            </Show>
            <Show when={page().id === 'knowledge'}>
              <DocsScreenshot
                src="/help/docs-knowledge-explorer-dark.png"
                caption="The Knowledge explorer with IT support topics, subtopic pills, and articles using fictional demo content"
              />
            </Show>
            <Show when={page().id === 'getting-started'}>
              <DocsScreenshot
                src="/help/docs-database-setup.png"
                caption="A new installation starts with database selection before account creation"
              />
            </Show>
            <Show when={page().id === 'roles-and-features'}>
              <DocsScreenshot
                src="/help/readme-my-work-dark.png"
                caption="Admins and agents use My Work to review their assigned workload"
              />
            </Show>
            <nav class="docs-page-pagination" aria-label="More documentation">
              <A href="/docs">All Guides</A>
              <Show when={documentationPages[documentationPages.indexOf(page()) + 1]}>
                {(next) => <A href={documentationPath(next())}>Next: {next().title} →</A>}
              </Show>
            </nav>
          </Show>
        </main>
        <aside class="docs-page-index">
          <nav aria-label="On this section">
            <strong>On this section</strong>
            <For each={headings()}>
              {(heading) => (
                <a
                  href={'#' + heading.id}
                  aria-current={activeHeading() === heading.id ? 'location' : undefined}
                >
                  {heading.label}
                </a>
              )}
            </For>
          </nav>
        </aside>
      </div>
    </div>
  );
}
