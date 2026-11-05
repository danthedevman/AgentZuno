import { publicAsset } from '../services/publicAsset.js';
import ProfileAvatar from '../components/ProfileAvatar.jsx';
import Icon from '../components/Icon.jsx';
import { useSession } from '../context/SessionContext.jsx';
import MarketingSection from '../components/MarketingSection.jsx';
import AnimatedRequestChat from '../components/AnimatedRequestChat.jsx';
import AnimatedKnowledgeChat from '../components/AnimatedKnowledgeChat.jsx';
import AnimatedWorkflowBuilder from '../components/AnimatedWorkflowBuilder.jsx';
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
    'Answer and automate user requests in Slack, Microsoft Teams, and email',
    'Deploy in a day',
  ]);

  onMount(async () => {
    if (import.meta.env.VITE_STATIC_SITE === 'true') return;
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
      document.title = `${site.name} | Open Source AI Help Desk`;
    } catch (error) {
      console.error('Could not load homepage mock data.', error);
    }
  });

  return (
    <main class="landing-main">
      <nav class="landing-top-navigation" aria-label="Public navigation">
        <A class="marketing-brand-mark" href="/" aria-label="AgentZuno home">
          <img
            src={publicAsset('/agentzuno-wordmark.svg')}
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
              <span class="brand-heading-ring" aria-hidden="true">
                <span class="sr-only">o</span>
              </span>
            </Show>
          </h1>
          <p class="tagline">
            <For each={tagline()}>{(line) => <span>{line}</span>}</For>
          </p>

          <div class="landing-actions">
            <A class="start-button" href="/register">
              Get access
            </A>
            <A class="start-button demo-button" href="/demo">
              Try It
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
            Explore the workflow SDK <span aria-hidden="true">→</span>
          </A>
        </div>
        <AnimatedWorkflowBuilder />
      </MarketingSection>
      <MarketingSection
        class="marketing-section marketing-split is-reversed"
        aria-labelledby="knowledge-feature-title"
      >
        <div class="marketing-copy">
          <h2 id="knowledge-feature-title">Put answers within reach</h2>
          <p>
            Give employees trusted answers wherever they work. Bring your organization’s knowledge
            into one place, ready to explore or find through conversation.
          </p>
          <p>
            Keep teams in control of who can access information and how it evolves, with review and
            approval built in.
          </p>
          <A href="/docs#knowledge">
            Explore the Knowledge guide <span aria-hidden="true">→</span>
          </A>
        </div>
        <AnimatedKnowledgeChat />
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
            One agent builds.
            <br />
            The other helps
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
              Read the Docs <span aria-hidden="true">→</span>
            </A>
          </div>
        </div>
        <div class="marketing-platform-preview marketing-agents-preview">
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
      <MarketingSection
        class="marketing-section marketing-split marketing-ownership"
        aria-labelledby="ownership-title"
      >
        <div
          class="marketing-copy ownership-graphic"
          aria-label="An open source alternative to Zendesk, JSM, Freshservice, and Serval"
        >
          <div class="ownership-vendors" aria-hidden="true">
            <span>Zendesk</span>
            <span>JSM</span>
            <span>Freshservice</span>
            <span>Serval</span>
          </div>
          <div class="ownership-brand">
            <img
              src={publicAsset('/agentzuno-wordmark.svg')}
              width="192"
              height="48"
              alt="AgentZuno"
            />
            <p>Build on your own terms</p>
          </div>
        </div>
        <div class="marketing-copy">
          <h2 id="ownership-title">
            Your infrastructure
            <br />
            Your terms
          </h2>
          <p>
            Host AgentZuno on infrastructure you already control and put your budget toward your
            team. The open source platform comes without mandatory per-user license fees or a
            platform contract.
          </p>
          <p>
            Keep control of your code, your data, and your choice of AI provider. Hosting, AI usage,
            and any third-party services are yours to choose and budget for.
          </p>
          <div class="ownership-benefits">
            <span>No expensive platform contracts</span>
            <span>No vendor lock-in</span>
            <span>No drama</span>
          </div>
        </div>
      </MarketingSection>
      <MarketingSection
        class="marketing-section marketing-open-source"
        aria-labelledby="make-it-yours-title"
      >
        <div class="marketing-section-intro">
          <h2 id="make-it-yours-title">Make it your own</h2>
          <p>
            Download the code, run it in your environment, and test it with your team. Change the
            experience, extend a workflow, or build something entirely your own.
          </p>
          <h3 class="marketing-ai-subtitle">No million-dollar dev team required</h3>
          <p>
            Use your favorite AI tools to understand the code, explore ideas, and build the changes
            your team needs. You have the source, and you decide where it goes next.
          </p>
          <div class="marketing-provider-links">
            <a
              href="https://openai.com/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="OpenAI"
            >
              <span class="provider-logo">
                <img
                  src={publicAsset('/provider-logos/openai.svg')}
                  width="32"
                  height="32"
                  alt=""
                />
              </span>
            </a>
            <a
              href="https://www.anthropic.com/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Anthropic"
            >
              <span class="provider-logo">
                <img
                  src={publicAsset('/provider-logos/anthropic.svg')}
                  width="32"
                  height="32"
                  alt=""
                />
              </span>
            </a>
            <a
              href="https://gemini.google.com/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Google Gemini"
            >
              <span class="provider-logo">
                <img
                  src={publicAsset('/provider-logos/gemini.png')}
                  width="32"
                  height="32"
                  alt=""
                />
              </span>
            </a>
          </div>
          <div class="landing-actions">
            <a
              class="start-button"
              href="https://github.com/danthedevman/agentzuno"
              target="_blank"
              rel="noopener noreferrer"
            >
              Get the Code <span aria-hidden="true">→</span>
            </a>
            <A class="start-button demo-button" href="/docs">
              Start Building
            </A>
          </div>
        </div>
      </MarketingSection>
      <footer class="marketing-footer">
        <div>
          <A class="marketing-footer-brand" href="/" aria-label="AgentZuno home">
            <img src={publicAsset('/agentzuno-wordmark.svg')} width="160" height="40" alt="" />
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
