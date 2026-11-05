import { BSON, ObjectId } from 'mongodb';
const encode = (value) => BSON.EJSON.serialize(value, { relaxed: false });
const key = (value) => JSON.stringify(encode(value));

// Push fixed scalar constraints into SQL; the document evaluator still enforces the full filter.
export function postgresWhere(filter, values) {
  const clauses = [];
  for (const [field, value] of Object.entries(filter || {})) {
    if (field === '$and') {
      for (const part of value) clauses.push(postgresWhere(part, values));
      continue;
    }
    if (
      ![
        '_id',
        'id',
        'ownerId',
        'workspaceId',
        'userId',
        'providerOwnerId',
        'requestId',
        'tableId',
        'status',
        'queueName',
        'assignedToId',
        'requesterId',
        'active',
        'enabled',
        'email',
      ].includes(field)
    )
      continue;
    if (
      value === undefined ||
      value === null ||
      (typeof value === 'object' && !(value instanceof ObjectId))
    )
      continue;
    values.push(field === '_id' ? key(value) : JSON.stringify(encode(value)));
    clauses.push(
      field === '_id'
        ? `id = $${values.length}`
        : `COALESCE(doc #> '{${field}}', 'null'::jsonb) = $${values.length}::jsonb`,
    );
  }
  return clauses.filter(Boolean).join(' AND ') || 'TRUE';
}
