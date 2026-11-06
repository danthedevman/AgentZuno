export function connectionStatus(connections = []) {
  if (!connections.length) return { label: 'Not configured', tone: 'muted' };
  if (connections.some((item) => item.sync?.status === 'Syncing' || item.status === 'Importing'))
    return { label: 'Syncing', tone: 'informational' };
  if (
    connections.some(
      (item) => item.sync?.status === 'Failed' || ['Failed', 'Error'].includes(item.status),
    )
  )
    return { label: 'Needs attention', tone: 'negative' };
  const active = connections.filter((item) => item.status === 'Connected');
  if (active.some((item) => item.authType !== 'export'))
    return { label: 'Active', tone: 'positive' };
  if (active.length) return { label: 'Imported snapshot', tone: 'informational' };
  if (connections.every((item) => item.status === 'Disconnected'))
    return { label: 'Disconnected', tone: 'muted' };
  return { label: 'Configured', tone: 'warning' };
}
