import { A } from '@solidjs/router';
import ChatMarkdown from '../components/ChatMarkdown.jsx';
import CodeBlock from '../components/CodeBlock.jsx';
import sdkGuide from '../../api/sdk/workflows/README.md?raw';
import sdkTypes from '../../api/sdk/workflows/index.d.ts?raw';
export default function DocsPage() {
  return (
    <div class="docs-page">
      <header class="docs-header">
        <A href="/" class="docs-brand">
          AgentZuno
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
            <a href="#getting-started">Getting Started</a>
            <a href="#workflow-sdk">Workflow SDK</a>
            <a href="#runtime-security">Sandbox &amp; Permissions</a>
            <a href="#type-reference">TypeScript Reference</a>
          </nav>
        </aside>
        <main class="docs-content">
          <h1>Documentation</h1>
          <section id="getting-started">
            <h2>Getting Started</h2>
            <p>
              Run the web app, API, worker, MongoDB, and Redis with Docker Compose. Configure an AI
              provider in workspace Settings, create queues, then build a workflow conversationally
              or edit its TypeScript. Review and publish the workflow before employees can use it.
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
          <section id="workflow-sdk">
            <ChatMarkdown text={sdkGuide.replace(/^# /, '## ')} />
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
