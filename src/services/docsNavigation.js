export const documentationPages = [
  {
    id: 'getting-started',
    slug: 'getting-started',
    title: 'Getting Started',
    file: 'getting-started.md',
    description:
      'Install AgentZuno with Docker, complete database setup, create your workspace, and connect an AI provider before your first request.',
  },
  {
    id: 'roles-and-features',
    slug: 'roles',
    title: 'Roles & Features',
    file: 'roles-and-features.md',
    description:
      'Learn what administrators, agents, employees, and read-only auditors can do in AgentZuno, with practical steps for everyday work.',
  },
  {
    id: 'requests-and-tasks',
    slug: 'requests-and-tasks',
    title: 'Requests & Tasks',
    file: 'requests-and-tasks.md',
    description:
      'Submit requests, manage fulfillment tasks and due dates, and collaborate with comments, private work notes, and mention notifications.',
  },
  {
    id: 'knowledge',
    slug: 'knowledge',
    title: 'Knowledge',
    file: 'knowledge.md',
    description:
      'Organize knowledge bases, topics, and articles, review proposed changes, publish guidance, and control who can read it.',
  },
  {
    id: 'database-setup',
    slug: 'databases',
    title: 'Database Setup',
    file: 'databases.md',
    description:
      'Choose MongoDB or PostgreSQL for your installation, configure bundled or external connections, and understand database setup and recovery.',
  },
  {
    id: 'agent-tools',
    slug: 'agents',
    title: 'Agents & Permissions',
    file: 'agent-tools.md',
    description:
      'Understand the Admin and support agents, structured tool calls, server authorization, separation of duties, and verified action results.',
  },
  {
    id: 'integrations',
    slug: 'integrations',
    title: 'Connections & Identity',
    file: 'integrations.md',
    description:
      'Configure supported Slack, Microsoft Teams, and Gmail connections, identity settings, connector actions, and permission-aware responses.',
  },
  {
    id: 'workflow-sdk',
    slug: 'workflows',
    title: 'Workflows',
    description:
      'Build AgentZuno workflows through conversation or TypeScript, collect request details, route work, and review approvals before publishing.',
  },
  {
    id: 'runtime-security',
    slug: 'security',
    title: 'Security & Sandbox',
    file: 'security.md',
    description:
      'Review AgentZuno security boundaries, workflow sandbox execution, access checks, credential handling, deployment requirements, and current limits.',
  },
  {
    id: 'type-reference',
    slug: 'workflow-reference',
    title: 'Workflow Code Reference',
    description:
      'Explore the AgentZuno workflow TypeScript definitions for forms, routing, approvals, tasks, and permitted workflow actions.',
  },
  {
    id: 'testing',
    slug: 'testing',
    title: 'Testing',
    file: 'testing.md',
    description:
      'Run AgentZuno API, browser, authorization, and database tests with repeatable fixtures and safe development checks.',
  },
  {
    id: 'recovery',
    slug: 'recovery',
    title: 'Backups & Upgrades',
    file: 'recovery.md',
    description:
      'Plan backups, protect encryption keys, restore workspace data, and review AgentZuno upgrade and recovery procedures.',
  },
  {
    id: 'capacity',
    slug: 'capacity',
    title: 'Capacity Testing',
    file: 'capacity.md',
    description:
      'Measure AgentZuno capacity with MongoDB and PostgreSQL, understand concurrency, and plan resources for your deployment.',
  },
];
export const documentationPath = (page) => `/docs/${page.slug}`;
export function rewriteDocumentationLinks(text) {
  for (const page of documentationPages) {
    const path = documentationPath(page);
    text = text.replaceAll(`/docs#${page.id}`, path);
    if (page.file) {
      text = text
        .replaceAll(`../../../docs/${page.file}`, path)
        .replaceAll(`docs/${page.file}`, path)
        .replaceAll(page.file, path);
    }
  }
  return text.replaceAll(
    'servicenow-setup.md',
    'https://github.com/danthedevman/agentzuno/blob/main/docs/servicenow-setup.md',
  );
}
