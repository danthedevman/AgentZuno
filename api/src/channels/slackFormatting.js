const escape = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function formatText(text) {
  return escape(text)
    .replace(
      /\[([^\]\n]+)\]\(([^\s)]+)\)|(https?:\/\/[^\s<>]+)/g,
      (_match, label, target, bare) => {
        const suffix = bare?.match(/[.,;:!?)]+$/)?.[0] || '';
        target ||= suffix ? bare.slice(0, -suffix.length) : bare;
        label ||= target;
        try {
          const href = target.replaceAll('&amp;', '&');
          const url = href.startsWith('/workspace/')
            ? new URL(href, process.env.APP_ORIGIN || 'http://localhost:3000')
            : new URL(href);
          if (
            !['https:', 'http:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            /[<>|]/.test(target) ||
            /&(lt|gt);/.test(target)
          )
            return label + suffix;
          return `<${escape(url.href)}|${label.replaceAll('|', ' ')}>${suffix}`;
        } catch {
          return label;
        }
      },
    )
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\*\*([^\n]+?)\*\*/g, '*$1*')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/^&gt; /gm, '> ');
}

export function formatSlackReply(text) {
  return String(text)
    .slice(0, 12000)
    .split(/(```[\s\S]*?```|`[^`\n]+`)/g)
    .map((part) =>
      part.startsWith('`')
        ? escape(part).replace(/^```[a-zA-Z0-9_-]+\n/, '```\n')
        : formatText(part),
    )
    .join('')
    .slice(0, 35000);
}

export function slackPortalFooter(workspaceId) {
  const path = `/workspace/${encodeURIComponent(workspaceId)}/chat`;
  const url = new URL(path, process.env.APP_ORIGIN || 'http://localhost:3000');
  return {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Have an issue? <${escape(url.href)}|View in AgentZuno’s Portal>`,
      },
    ],
  };
}
