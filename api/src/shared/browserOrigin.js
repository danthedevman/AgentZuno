const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
export function isAllowedBrowserOrigin(value, configured) {
  try {
    const origin = new URL(value);
    const expected = new URL(configured);
    if (value !== origin.origin || origin.username || origin.password) return false;
    if (origin.origin === expected.origin) return true;
    // Local browser URLs commonly use either loopback spelling. Keep protocol and port fixed.
    return (
      loopbackHosts.has(origin.hostname) &&
      loopbackHosts.has(expected.hostname) &&
      origin.protocol === expected.protocol &&
      origin.port === expected.port
    );
  } catch {
    return false;
  }
}
