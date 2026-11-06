export const supportIcons = [
  { value: 'agent', label: 'Assistant' },
  { value: 'chat', label: 'Chat' },
  { value: 'help', label: 'Help' },
  { value: 'neural', label: 'Intelligence' },
  { value: 'task', label: 'Checkmark' },
];
export function supportIdentity(settings) {
  return {
    name: settings?.supportAgentName || 'Zuno',
    icon: supportIcons.some((item) => item.value === settings?.supportAgentIcon)
      ? settings.supportAgentIcon
      : 'agent',
  };
}
export function validateSupportIdentity(name, icon) {
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > 60 ||
    /[<>\x00-\x1f\x7f]/u.test(name)
  )
    throw Object.assign(
      new Error('Agent name must contain 1–60 characters without markup or line breaks.'),
      { status: 400 },
    );
  if (!supportIcons.some((item) => item.value === icon))
    throw Object.assign(new Error('Choose an available agent icon.'), { status: 400 });
  return { supportAgentName: name.trim(), supportAgentIcon: icon };
}
