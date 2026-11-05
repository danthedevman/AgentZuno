import { queryString } from './queryValues.js';
export const requestError = (message, status = 400) => {
  throw Object.assign(new Error(message), { status, publicMessage: message });
};
export function requestText(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    requestError(`${name} must contain 1–${max} characters.`);
  return value.trim();
}
export function requestChoice(value, options, name) {
  if (typeof value !== 'string' || !options.includes(value)) requestError(`Invalid ${name}.`);
  return queryString(value);
}
export function requestFields(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) requestError('Invalid request.');
  if (Object.keys(input).some((key) => !allowed.includes(key))) requestError('Unsupported field.');
}

