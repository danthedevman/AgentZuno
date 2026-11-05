export const commonTimeZones = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'Eastern Time — New York' },
  { value: 'America/Chicago', label: 'Central Time — Chicago' },
  { value: 'America/Denver', label: 'Mountain Time — Denver' },
  { value: 'America/Los_Angeles', label: 'Pacific Time — Los Angeles' },
  { value: 'America/Phoenix', label: 'Arizona — Phoenix' },
  { value: 'America/Anchorage', label: 'Alaska — Anchorage' },
  { value: 'Pacific/Honolulu', label: 'Hawaii — Honolulu' },
  { value: 'America/Sao_Paulo', label: 'Brazil — São Paulo' },
  { value: 'Europe/London', label: 'United Kingdom — London' },
  { value: 'Europe/Paris', label: 'Central Europe — Paris' },
  { value: 'Europe/Helsinki', label: 'Eastern Europe — Helsinki' },
  { value: 'Africa/Johannesburg', label: 'South Africa — Johannesburg' },
  { value: 'Asia/Dubai', label: 'United Arab Emirates — Dubai' },
  { value: 'Asia/Kolkata', label: 'India — Kolkata' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Shanghai', label: 'China — Shanghai' },
  { value: 'Asia/Tokyo', label: 'Japan — Tokyo' },
  { value: 'Australia/Sydney', label: 'Australia — Sydney' },
  { value: 'Pacific/Auckland', label: 'New Zealand — Auckland' },
];
export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
export function timeZoneOptions(value) {
  return value && !commonTimeZones.some((option) => option.value === value)
    ? [{ value, label: value.replaceAll('_', ' ') }, ...commonTimeZones]
    : commonTimeZones;
}
