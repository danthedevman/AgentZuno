const multilineFieldIds = new Set([
  'description',
  'details',
  'notes',
  'routingInstructions',
  'routing-instructions',
]);

export function isMultilineField(field) {
  return field.multiline || field.type === 'textarea' || multilineFieldIds.has(field.id);
}
