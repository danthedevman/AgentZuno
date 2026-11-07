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

export function isOperationalField(field) {
  return (
    ['reference', 'date', 'datetime', 'datetime-local'].includes(field.type) ||
    [
      'status',
      'state',
      'priority',
      'dueDate',
      'assignedTo',
      'assignedToId',
      'assignmentGroup',
      'queueName',
      'createdAt',
      'updatedAt',
    ].includes(field.id)
  );
}
