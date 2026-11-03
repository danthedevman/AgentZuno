export function displayLabel(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}
export function statusLabel(value) {
  return value === 'waiting-for-employee'
    ? 'Awaiting Response'
    : value === 'waiting-for-approval'
      ? 'Awaiting Approval'
      : displayLabel(value);
}
