// Validate before converting so query operators cannot arrive disguised as scalar values.
function invalid() {
  throw Object.assign(new Error('Invalid query value.'), {
    status: 400,
    publicMessage: 'Invalid query value.',
  });
}
export function queryString(value, max = 1024) {
  if (typeof value !== 'string' || !value || value.length > max) invalid();
  return String(value);
}
export function queryVersion(value) {
  if (!Number.isSafeInteger(value) || value < 0) invalid();
  return Number(value);
}
export function queryStrings(values, limit = 100, max = 1024) {
  if (!Array.isArray(values) || values.length > limit) invalid();
  return values.map((value) => queryString(value, max));
}
