import { createHash } from 'node:crypto';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const failure = (message, status = 400) =>
  Object.assign(new Error(message), { status, publicMessage: message });
export const providers = {
  notion: {
    authorize: 'https://api.notion.com/v1/oauth/authorize',
    token: 'https://api.notion.com/v1/oauth/token',
    prefix: 'NOTION',
  },
  confluence: {
    authorize: 'https://auth.atlassian.com/authorize',
    token: 'https://auth.atlassian.com/oauth/token',
    prefix: 'ATLASSIAN',
  },
};
