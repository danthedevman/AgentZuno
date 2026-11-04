import { A, useLocation } from '@solidjs/router';
import { createSignal, onMount, onCleanup } from 'solid-js';
import ChatMarkdown from '../components/ChatMarkdown.jsx';
import CodeBlock from '../components/CodeBlock.jsx';
import rolesGuide from '../../docs/roles-and-features.md?raw';
import databaseGuide from '../../docs/databases.md?raw';
import sdkGuide from '../../api/sdk/workflows/README.md?raw';
import sdkTypes from '../../api/sdk/workflows/index.d.ts?raw';
export default function DocsPage() {
  const location = useLocation();
  const sectionIds = [
    'getting-started',
    'roles-and-features',
    'database-setup',
    'workflow-sdk',
    'runtime-security',
    'type-reference',
  ];
  const [activeSection, setActiveSection] = createSignal('getting-started');
  let content;
  onMount(() => {
    const sections = sectionIds.map((id) => content.querySelector(`#${id}`));
    let frame;
    const updateActiveSection = () => {
      frame = undefined;
      let current = sectionIds[0];
      for (const section of sections) {
        if (section.getBoundingClientRect().top <= 150) current = section.id;
      }
      setActiveSection(current);
    };
    const scheduleUpdate = () => {
      if (frame === undefined) frame = requestAnimationFrame(updateActiveSection);
    };
    const openAnchor = () => {
      const id =
        location.hash.slice(1) ||
        (location.pathname === '/docs/workflows' ? 'workflow-sdk' : 'getting-started');
      if (sectionIds.includes(id)) {
        content.querySelector(`#${id}`).scrollIntoView();
        setActiveSection(id);
      }
    };
    openAnchor();
    updateActiveSection();
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('hashchange', openAnchor);
    onCleanup(() => {
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('hashchange', openAnchor);
      if (frame !== undefined) cancelAnimationFrame(frame);
    });
  });
  return (
    <div class="docs-page">
      <header class="docs-header">
        <A href="/" class="docs-brand">
          <img src="/agentzuno-wordmark.svg" alt="AgentZuno" width="144" height="36" />
        </A>
        <nav aria-label="Public navigation">
          <A href="/docs" aria-current="page">
            Docs
          </A>
          <A href="/login">Sign In</A>
          <A class="workspace-button small" href="/register">
            Get Access
          </A>
        </nav>
      </header>
      <div class="docs-layout">
        <aside class="docs-navigation">
          <nav aria-label="Documentation">
            <a
              href="#getting-started"
              aria-current={activeSection() === 'getting-started' ? 'location' : undefined}
            >
              Getting Started
            </a>
            <a
              href="#roles-and-features"
              aria-current={activeSection() === 'roles-and-features' ? 'location' : undefined}
            >
              Roles &amp; Features
            </a>
            <a
              href="#database-setup"
              aria-current={activeSection() === 'database-setup' ? 'location' : undefined}
            >
              Database Setup
            </a>
            <a
              href="#workflow-sdk"
              aria-current={activeSection() === 'workflow-sdk' ? 'location' : undefined}
            >
              Workflow SDK
            </a>
            <a
              href="#runtime-security"
              aria-current={activeSection() === 'runtime-security' ? 'location' : undefined}
            >
              Sandbox &amp; Permissions
            </a>
            <a
              href="#type-reference"
              aria-current={activeSection() === 'type-reference' ? 'location' : undefined}
            >
              TypeScript Reference
            </a>
          </nav>
        </aside>
        <main class="docs-content" ref={content}>
          <h1>Documentation</h1>
          <section id="getting-started">
            <h2>Getting Started</h2>
            <p>
              Run the web app, API, worker, and infrastructure with Docker Compose. Choose MongoDB
              or PostgreSQL before registering the first account. Configure an AI provider in
              workspace Settings, create queues, then build a workflow conversationally or edit its
              TypeScript. Review and publish the workflow before employees can use it.
            </p>
            <CodeBlock
              language="bash"
              code={'docker compose up --build -d\n# Open http://localhost:3000'}
            />
            <p>
              AI provider credentials and connector credentials stay on the server. Configure each
              channel before using it with employees.
            </p>
          </section>
          <section id="roles-and-features">
            <ChatMarkdown text={rolesGuide.replace(/^# /, '## ')} externalLinksNewTab />
          </section>
          <section id="database-setup">
            <ChatMarkdown
              text={databaseGuide.replaceAll('roles-and-features.md', '/docs#roles-and-features')}
              externalLinksNewTab
            />
          </section>
          <section id="workflow-sdk">
            <ChatMarkdown
              text={sdkGuide
                .replace(/^# /, '## ')
                .replaceAll('../../../docs/roles-and-features.md', '/docs#roles-and-features')}
            />
          </section>
          <section id="runtime-security">
            <h2>Sandbox &amp; Permissions</h2>
            <p>
              Published TypeScript runs in a fresh QuickJS WebAssembly runtime inside a worker
              thread. The code has no direct network, filesystem, environment, or credential access.
              The backend gateway checks each SDK action against the published workflow and current
              workspace permissions.
            </p>
            <p>
              Approvals pause a durable run. Completed step receipts are reused during replay.
              Uncertain external delivery needs investigation; execution does not promise
              exactly-once delivery.
            </p>
          </section>
          <section id="type-reference">
            <h2>TypeScript Reference</h2>
            <CodeBlock language="typescript" code={sdkTypes} />
          </section>
        </main>
      </div>
    </div>
  );
}
