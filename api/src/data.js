import { readFile } from 'node:fs/promises';

const directory = new URL('../mock-data/', import.meta.url);

export async function readData(filename) {
  return JSON.parse(await readFile(new URL(filename, directory), 'utf8'));
}

export async function readWorkspace(user) {
  if (!user || user.isDemo || ['alex', 'jordan'].includes(user.id))
    throw Object.assign(new Error('Sign in to view the workspace.'), { status: 401 });
  return {
    mode: 'personal',
    id: user.workspaceId,
    name: `${user.name}’s workspace`,
    description: 'Your knowledge workspace.',
    knowledgeBases: [
      {
        id: user.workspaceId,
        name: 'General',
        description: 'Your workspace knowledge.',
        icon: 'layers',
      },
    ],
    articles: [],
    files: [],
    images: [],
    agents: [],
    integrations: [],
    tasks: [],
    topics: [],
  };
}
