import ProfileAvatar from '../components/ProfileAvatar.jsx';
import Icon from '../components/Icon.jsx';
import { useSession } from '../context/SessionContext.jsx';
import MarketingSection from '../components/MarketingSection.jsx';
import AnimatedRequestChat from '../components/AnimatedRequestChat.jsx';
import { For, Show, createSignal, onMount } from 'solid-js';
import HeroWorkflowBackground from '../components/HeroWorkflowBackground.jsx';
import { A, useNavigate } from '@solidjs/router';

export default function HomePage() {
  const { session } = useSession();
  const user = () => (session.error ? null : session()?.user);
  const workspaceUrl = () =>
    `/workspace/${user()?.impersonation?.workspaceId || user()?.workspaceId}`;
  const navigate = useNavigate();
  const [name, setName] = createSignal('AgentZuno');
  const [tagline, setTagline] = createSignal([
    'AgentZuno is an open source conversational AI help desk',
    'Answer and automate user requests in Slack, Microsoft Teams, and email across your entire org',
    'Deploy in a day',
  ]);

  onMount(async () => {
    try {
      const portalResponse = await fetch('/api/portal');
      if (portalResponse.ok) {
        const portal = await portalResponse.json();
        if (/^[a-f0-9]{24}$/.test(portal.workspaceId || '')) {
          navigate(`/workspace/${portal.workspaceId}/chat`, { replace: true });
          return;
        }
      }
      const response = await fetch('/api/site');

      if (!response.ok) {
        throw new Error(`Mock data request failed: ${response.status}`);
      }

      const site = await response.json();

      if (typeof site.name !== 'string' || !site.name.trim()) {
        throw new Error('Site mock data must include a name.');
      }

      setName(site.name);
      if (Array.isArray(site.tagline) && site.tagline.every((line) => typeof line === 'string')) {
        setTagline(site.tagline);
      }
      document.title = site.name;
    } catch (error) {
      console.error('Could not load homepage mock data.', error);
    }
  });

  return (
    <main class="landing-main">
      <nav class="landing-top-navigation" aria-label="Public navigation">
        <A class="marketing-brand-mark" href="/" aria-label="AgentZuno home">
          <img
            src="/agentzuno-wordmark.svg"
            loading="eager"
            fetchpriority="high"
            decoding="sync"
            width="128"
            height="32"
            alt=""
          />
        </A>
        <A href="/docs">Docs</A>
        <Show when={user()} fallback={<A href="/login">Sign in</A>}>
          <A class="marketing-open-workspace" href={workspaceUrl()}>
            <ProfileAvatar
              userId={user()?.id}
              name={user()?.name}
              version={user()?.profilePictureVersion}
            />
            <span>Open Workspace</span>
          </A>
        </Show>
      </nav>
      <MarketingSection class="homepage" aria-labelledby="app-name">
        <div class="landing-hero-copy">
          <h1 id="app-name" aria-label={name()}>
            <Show when={name().endsWith('o')} fallback={name()}>
              <span aria-hidden="true">{name().slice(0, -1)}</span>
              <span class="brand-heading-ring" aria-hidden="true" />
            </Show>
          </h1>
          <p class="tagline">
            <For each={tagline()}>{(line) => <span>{line}</span>}</For>
          </p>

          <div class="landing-actions">
            <A class="start-button" href="/register">
              Get access
            </A>
            <A class="start-button demo-button" href="/workspace">
              Open workspace
            </A>
          </div>
        </div>
        <HeroWorkflowBackground />
      </MarketingSection>
      <MarketingSection
        class="marketing-section marketing-centered"
        aria-labelledby="workflow-examples-title"
      >
        <div class="marketing-section-intro">
          <h2 id="workflow-examples-title">
            Everyday requests
            <br />A clearer way forward
          </h2>
          <p>
            Turn the questions employees ask into guided conversations. Collect the right details,
            bring in the right people, and keep the request moving with workflows built for your
            organization.
          </p>
        </div>
        <AnimatedRequestChat />
      </MarketingSection>
      <MarketingSection
        class="marketing-section marketing-split"
        aria-labelledby="build-workflows-title"
      >
        <div class="marketing-copy">
          <h2 id="build-workflows-title">
            Describe the process
            <br />
            Shape the workflow
          </h2>
          <p>
            Tell the Admin agent what should happen. Build forms, add conditional routing, choose
            queues, and request approvals through conversation. Review the visual flow or edit its
            TypeScript before publishing.
          </p>
          <A href="/docs/workflows">
            Explore the workflow SDK <span aria-hidden="true">↗</span>
          </A>
        </div>
        <div class="marketing-workflow-preview" aria-label="Laptop request workflow">
          <div class="marketing-preview-top">
            <span>Laptop Request</span>
          </div>
          <For
            each={[
              'Collect laptop and accessory choices',
              'Ask the employee’s manager to approve',
              'Route to Desktop Support',
            ]}
          >
            {(label, index) => (
              <div class="marketing-workflow-step">
                <span>{index() + 1}</span>
                <p>{label}</p>
              </div>
            )}
          </For>
          <div class="marketing-preview-bottom">Forms · Conditions · Approvals · Queues</div>
        </div>
      </MarketingSection>
      <MarketingSection
        class="marketing-section marketing-split is-reversed"
        aria-labelledby="knowledge-feature-title"
      >
        <div class="marketing-copy">
          <h2 id="knowledge-feature-title">Put answers within reach</h2>
          <p>
            Organize articles into knowledge bases and topics. Let employees browse the Knowledge
            Center, or have the agents reference permitted published articles in conversation.
            Readers can open an article alongside the chat without losing their place.
          </p>
          <p>
            Set access at the base, topic, and article level. Proposed article changes get a preview
            and require approval before they are saved.
          </p>
          <A href="/docs#runtime-security">
            Learn about access controls <span aria-hidden="true">↗</span>
          </A>
        </div>
        <div class="marketing-knowledge-preview">
          <div class="marketing-preview-top">Knowledge Center</div>
          <div class="marketing-knowledge-folders">
            <span>Getting Started</span>
            <span>IT Support</span>
            <span>People &amp; Teams</span>
          </div>
          <div class="marketing-knowledge-article">
            <small>IT Support / Software</small>
            <h3>How to request software access</h3>
            <p>
              Find the right request, provide the details, and track the approval in one
              conversation.
            </p>
            <span>Published Article</span>
          </div>
        </div>
      </MarketingSection>
      <MarketingSection
        class="marketing-section marketing-centered marketing-governance"
        aria-labelledby="governance-feature-title"
      >
        <div class="marketing-section-intro">
          <h2 id="governance-feature-title">Keep people in control</h2>
          <p>
            Set clear boundaries for access, keep people involved in important decisions, and give
            teams a shared record of activity.
          </p>
        </div>
        <div class="marketing-feature-grid">
          <article>
            <span>01</span>
            <h3>Controlled Access</h3>
            <p>Give teams confidence that the right people can access the right information.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Human Oversight</h3>
            <p>
              Keep people involved in decisions that need judgment, with clear ownership and
              accountability.
            </p>
          </article>
          <article>
            <span>03</span>
            <h3>Operational Visibility</h3>
            <p>
              Understand what happened across your organization and give teams the context they need
              for review.
            </p>
          </article>
        </div>
      </MarketingSection>
      <MarketingSection
        class="marketing-section marketing-split"
        aria-labelledby="open-source-feature-title"
      >
        <div class="marketing-copy">
          <h2 id="open-source-feature-title">
            An agent to build
            <br />
            An agent to help
          </h2>
          <p>
            Two agents work with clear responsibilities. The Admin agent helps your administrators
            build workflows and propose knowledge updates. Zuno helps employees find answers, submit
            requests, and use the workflows your team has published.
          </p>
          <p>
            Separate permissions keep employee conversations from changing administrative settings.
            Run the open source platform in your environment and choose your AI provider.
          </p>
          <div class="marketing-section-actions">
            <A class="start-button" href="/register">
              Get Access
            </A>
            <A href="/docs">
              Read the Docs <span aria-hidden="true">↗</span>
            </A>
          </div>
        </div>
        <div class="marketing-platform-preview marketing-agents-preview">
          <span class="marketing-platform-label">AgentZuno</span>
          <h3>Two agents, one connected help desk</h3>
          <article>
            <Icon name="agent" class="marketing-agent-mark" />
            <div>
              <h4>Admin Agent</h4>
              <p>Design workflows, draft articles, and propose configuration changes for review.</p>
              <small>Authorized Administrators</small>
            </div>
          </article>
          <article>
            <Icon name="agent" class="marketing-agent-mark" />
            <div>
              <h4>Zuno</h4>
              <p>
                Answer employee questions, guide requests, and use permitted published workflows.
              </p>
              <small>Employee Support</small>
            </div>
          </article>
        </div>
      </MarketingSection>
      <footer class="marketing-footer">
        <div>
          <A class="marketing-footer-brand" href="/" aria-label="AgentZuno home">
            <img src="/agentzuno-wordmark.svg" width="160" height="40" alt="" />
          </A>
          <p>Conversations that move work forward</p>
        </div>
        <nav aria-label="Footer navigation">
          <A href="/docs">Documentation</A>
          <A href="/docs/workflows">Workflow SDK</A>
          <A href="/login">Sign In</A>
          <A href="/register">Get Access</A>
        </nav>
        <small>© {new Date().getFullYear()} AgentZuno</small>
      </footer>
    </main>
  );
}
