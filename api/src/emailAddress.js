export function isEmailAddress(value) {
  if (typeof value !== 'string' || value.length > 254 || /[\s@]/.test(value.replace('@', '')))
    return false;
  const separator = value.indexOf('@');
  if (separator < 1) return false;
  const domain = value.slice(separator + 1);
  const dot = domain.lastIndexOf('.');
  return dot > 0 && dot < domain.length - 1;
}
