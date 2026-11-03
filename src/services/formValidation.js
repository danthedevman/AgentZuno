export function validateValue(field) {
  const label = field.label || 'This field';
  const value = String(field.value ?? '');
  if (field.reference)
    return field.required && !field.selectedCount ? `Select ${label.toLowerCase()}.` : '';
  if (field.type === 'file') {
    const file = field.file;
    if (!file) return field.required ? `Choose ${label.toLowerCase()}.` : '';
    if (!file.size) return 'Choose a file that is not empty.';
    if (file.size > (field.maxBytes || 5 * 1024 * 1024))
      return `Choose a file no larger than ${(field.maxBytes || 5 * 1024 * 1024) / 1024 / 1024} MB.`;
    if (
      field.accept &&
      !field.accept.split(',').some((entry) => {
        const allowed = entry.trim().toLowerCase();
        return allowed.startsWith('.')
          ? file.name.toLowerCase().endsWith(allowed)
          : allowed.endsWith('/*')
            ? file.type.startsWith(allowed.slice(0, -1))
            : file.type === allowed;
      })
    )
      return `Choose a supported file type: ${field.accept}.`;
    return '';
  }
  if (field.required && !value.trim()) return `Enter ${label.toLowerCase()}.`;
  if (!value) return '';
  if (field.minLength > 0 && value.length < field.minLength)
    return `Use at least ${field.minLength} characters.`;
  if (field.maxLength > 0 && value.length > field.maxLength)
    return `Use no more than ${field.maxLength} characters.`;
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))
    return 'Enter a valid email address.';
  if (field.type === 'url') {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash)
        return 'Use an HTTPS URL without embedded credentials or a fragment.';
    } catch {
      return 'Enter a valid HTTPS URL.';
    }
  }
  if (field.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'Enter a valid number.';
    if (field.min !== undefined && number < field.min) return `Enter ${field.min} or more.`;
    if (field.max !== undefined && number > field.max) return `Enter ${field.max} or less.`;
    if (field.step === '1' && !Number.isInteger(number)) return 'Enter a whole number.';
  }
  if (field.pattern && !new RegExp(`^(?:${field.pattern})$`).test(value))
    return `Enter a valid ${label.toLowerCase()}.`;
  return '';
}
