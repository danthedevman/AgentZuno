import { documentationPages, documentationPath } from './docsNavigation.js';
export const publicPages = [
  {
    path: '',
    title: 'AgentZuno | Open Source AI Help Desk',
    description:
      'Answer and automate employee requests with an open source AI help desk. Build workflows through conversation and host AgentZuno on your own infrastructure.',
  },
  {
    path: 'docs',
    title: 'Documentation | AgentZuno',
    description:
      'Find concise AgentZuno guides for employee requests, knowledge, workflows, and workspace setup, with separate developer and operations references.',
  },
  ...documentationPages.map((page) => ({
    path: documentationPath(page).slice(1),
    title: `${page.title} | AgentZuno Docs`,
    description: page.description,
  })),
];
