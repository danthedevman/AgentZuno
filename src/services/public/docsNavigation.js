export const documentationCategories = [
  'Use AgentZuno',
  'Administration',
  'Developer and operations',
];

export const documentationPages = [
  {
    id: 'getting-started',
    slug: 'getting-started',
    title: 'Getting Started',
    file: 'getting-started.md',
    legacyHeadings: ['docker', 'local-node-development', 'checks'],
    anchorAliases: {
      'local-node-development': '/docs/local-development#local-node-development',
      checks: '/docs/local-development#checks',
    },
    category: 'Use AgentZuno',
    description:
      'Install AgentZuno with Docker, complete database setup, create your workspace, and connect an AI provider before your first request.',
  },
  {
    id: 'roles-and-features',
    slug: 'roles',
    title: 'Roles & Features',
    file: 'roles-and-features.md',
    legacyHeadings: [
      'choose-the-right-role',
      'set-up-the-workspace-admin',
      'build-a-request-workflow-admin',
      'ask-for-help-and-submit-a-request-user-agent-or-admin',
      'work-on-requests-agent-or-admin',
      'decide-an-approval-assigned-approver',
      'publish-and-read-knowledge',
      'manage-reference-information-admin',
      'review-reports-and-audit-admin-or-read-only',
      'try-fictional-records-in-your-workspace',
      'keep-your-profile-current',
      'fulfillment-tasks',
      'task-dates-and-record-conversations',
    ],
    anchorAliases: {
      'set-up-the-workspace-admin': '/docs/getting-started#set-up-your-workspace',
      'build-a-request-workflow-admin': '/docs/workflows#build-a-workflow-through-conversation',
      'ask-for-help-and-submit-a-request-user-agent-or-admin':
        '/docs/requests-and-tasks#submit-and-follow-a-request',
      'work-on-requests-agent-or-admin': '/docs/requests-and-tasks#create-and-work-on-a-task',
      'decide-an-approval-assigned-approver': 'approval-permission',
      'publish-and-read-knowledge': '/docs/knowledge#publish-and-maintain-content',
      'manage-reference-information-admin': 'manage-reference-information',
      'review-reports-and-audit-admin-or-read-only': 'review-reports-and-audit',
      'try-fictional-records-in-your-workspace': '/docs/getting-started#try-your-first-request',
      'fulfillment-tasks': '/docs/requests-and-tasks#create-and-work-on-a-task',
      'task-dates-and-record-conversations':
        '/docs/requests-and-tasks#comments-work-notes-and-mentions',
    },
    category: 'Use AgentZuno',
    description:
      'Learn what administrators, agents, employees, and read-only auditors can do in AgentZuno, with practical steps for everyday work.',
  },
  {
    id: 'requests-and-tasks',
    slug: 'requests-and-tasks',
    title: 'Requests & Tasks',
    file: 'requests-and-tasks.md',
    legacyHeadings: [
      'choose-the-right-role',
      'submit-and-follow-a-request',
      'create-and-work-on-a-task',
      'comments-work-notes-and-mentions',
      'approve-or-reject-work',
      'if-something-is-missing',
      'request-selection',
      'deleting-a-workflow',
    ],
    anchorAliases: {
      'choose-the-right-role': '/docs/roles#choose-the-right-role',
      'request-selection': '/docs/workflows#employee-requests',
      'deleting-a-workflow': '/docs/workflows#delete-a-workflow',
    },
    category: 'Use AgentZuno',
    description:
      'Submit requests, manage fulfillment tasks and due dates, and collaborate with comments, private work notes, and mention notifications.',
  },
  {
    id: 'knowledge',
    slug: 'knowledge',
    title: 'Knowledge',
    file: 'knowledge.md',
    legacyHeadings: [
      'who-can-do-what',
      'organize-bases-and-topics',
      'draft-an-article-through-conversation',
      'publish-and-maintain-content',
      'find-answers-in-chat',
      'control-access',
    ],
    anchorAliases: { 'who-can-do-what': '/docs/roles#choose-the-right-role' },
    category: 'Use AgentZuno',
    description:
      'Organize knowledge bases, topics, and articles, review proposed changes, publish guidance, and control who can read it.',
  },
  {
    id: 'workflow-sdk',
    slug: 'workflows',
    title: 'Workflows',
    file: 'workflows.md',
    legacyHeadings: [
      'build-a-workflow-through-conversation',
      'use-workflow-code',
      'build-test-and-publish',
      'runtime-and-operational-limits',
      'reference-fields',
      'create-a-fulfillment-task',
    ],
    anchorAliases: {
      'build-test-and-publish': '/docs/workflow-sdk#build-test-and-publish',
      'runtime-and-operational-limits': '/docs/workflow-sdk#runtime-and-operational-limits',
      'reference-fields': '/docs/workflow-sdk#reference-fields',
      'create-a-fulfillment-task': '/docs/workflow-sdk#create-a-fulfillment-task',
    },
    category: 'Use AgentZuno',
    description:
      'Build AgentZuno workflows through conversation or TypeScript, collect request details, route work, and review approvals before publishing.',
  },
  {
    id: 'agent-tools',
    slug: 'agents',
    title: 'Agents & Permissions',
    file: 'agent-tools.md',
    category: 'Administration',
    description:
      'Understand the Admin and support agents, structured tool calls, server authorization, separation of duties, and verified action results.',
  },
  {
    id: 'integrations',
    slug: 'integrations',
    title: 'Connections & Identity',
    file: 'integrations.md',
    category: 'Administration',
    description:
      'Configure supported Slack, Microsoft Teams, and Gmail connections, identity settings, connector actions, and permission-aware responses.',
  },
  {
    id: 'slack',
    slug: 'slack',
    title: 'Connect Slack',
    file: 'slack.md',
    category: 'Administration',
    description:
      'Install the Slack bot, configure OAuth and Events URLs, review bulk user matches, link accounts securely, and test permission-aware support conversations.',
  },
  {
    id: 'database-setup',
    slug: 'databases',
    title: 'Database Setup',
    file: 'databases.md',
    category: 'Administration',
    description:
      'Choose MongoDB or PostgreSQL for your installation, configure bundled or external connections, and understand database setup and recovery.',
  },
  {
    id: 'deployment',
    slug: 'deployment',
    title: 'Deployment & Hosting',
    file: 'deployment.md',
    category: 'Administration',
    description:
      'Compare AgentZuno hosting options, plan HTTPS and persistent services, and follow deployment guides for Render, AWS, or a Linux server.',
  },
  {
    id: 'render',
    slug: 'render',
    title: 'Deploy on Render',
    file: 'render.md',
    category: 'Administration',
    description:
      'Deploy AgentZuno with the included Render Blueprint, connect your database, configure domains and integrations, and verify backups and service health.',
  },
  {
    id: 'aws',
    slug: 'aws',
    title: 'Deploy on AWS',
    file: 'aws.md',
    category: 'Administration',
    description:
      'Run AgentZuno on AWS EC2 with Docker Compose, configure HTTPS and private ports, complete database setup, and plan backups or a managed ECS deployment.',
  },
  {
    id: 'workflow-development',
    slug: 'workflow-sdk',
    title: 'Workflow SDK',
    sourcePaths: ['../api/sdk/workflows/README.md'],
    category: 'Developer and operations',
    description:
      'Use the optional AgentZuno workflow SDK for local TypeScript authoring, examples, offline tests, and runtime limits; no install is needed in the app.',
  },
  {
    id: 'type-reference',
    slug: 'workflow-reference',
    title: 'Workflow Code Reference',
    sourcePaths: ['../api/sdk/workflows/index.d.ts'],
    category: 'Developer and operations',
    description:
      'Explore the AgentZuno workflow TypeScript definitions for forms, routing, approvals, tasks, and permitted workflow actions.',
  },
  {
    id: 'local-development',
    slug: 'local-development',
    title: 'Local Development',
    file: 'local-development.md',
    category: 'Developer and operations',
    description:
      'Set up Node.js and local services to change AgentZuno itself, run the web app, API, and worker separately, and check your changes.',
  },
  {
    id: 'runtime-security',
    slug: 'security',
    title: 'Security & Sandbox',
    file: 'security.md',
    category: 'Developer and operations',
    description:
      'Review AgentZuno security boundaries, workflow sandbox execution, access checks, credential handling, deployment requirements, and current limits.',
  },
  {
    id: 'testing',
    slug: 'testing',
    title: 'Testing',
    file: 'testing.md',
    category: 'Developer and operations',
    description:
      'Run AgentZuno API, browser, authorization, and database tests with repeatable fixtures and safe development checks.',
  },
  {
    id: 'recovery',
    slug: 'recovery',
    title: 'Backups & Upgrades',
    file: 'recovery.md',
    category: 'Developer and operations',
    description:
      'Plan backups, protect encryption keys, restore workspace data, and review AgentZuno upgrade and recovery procedures.',
  },
  {
    id: 'capacity',
    slug: 'capacity',
    title: 'Capacity Testing',
    file: 'capacity.md',
    category: 'Developer and operations',
    description:
      'Measure AgentZuno capacity with MongoDB and PostgreSQL, understand concurrency, and plan resources for your deployment.',
  },
];
export const documentationPath = (page) => `/docs/${page.slug}`;
export function rewriteDocumentationLinks(text) {
  for (const page of documentationPages) {
    const path = documentationPath(page);
    text = text.replaceAll(`/docs#${page.id}`, path);
    for (const sourcePath of page.sourcePaths || []) text = text.replaceAll(sourcePath, path);
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

export function documentationAnchorTarget(page, hash) {
  if (!page || !hash) return null;
  let id;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    return null;
  }
  const legacy = id.match(new RegExp(`^${page.id}-(\\d+)$`));
  if (legacy && page.legacyHeadings) id = page.legacyHeadings[Number(legacy[1]) - 1] || id;
  const alias = page.anchorAliases?.[id];
  if (alias) return alias.startsWith('/') ? alias : `${documentationPath(page)}#${alias}`;
  return legacy && page.legacyHeadings ? `${documentationPath(page)}#${id}` : null;
}
