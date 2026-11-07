export function secureCookies() {
  return (
    process.env.COOKIE_SECURE === 'true' ||
    new URL(process.env.APP_ORIGIN || 'http://localhost:3000').protocol === 'https:'
  );
}
