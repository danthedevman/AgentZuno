import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { postgresWhere } from '../src/storage/postgresQuery.js';

test('PostgreSQL scalar filters bind values and never interpolate caller fields or operators', () => {
  const values = [];
  const hostile = "x' OR TRUE --";
  const sql = postgresWhere(
    {
      ownerId: hostile,
      workspaceId: 'workspace',
      status: 'open',
      assignedToId: 'agent',
      [hostile]: 'ignored',
      title: { $regex: '.*' },
      $or: [{ ownerId: 'other' }],
    },
    values,
  );
  assert.ok(!sql.includes(hostile));
  assert.equal(values.length, 4);
  assert.equal(JSON.parse(values[0]), hostile);
  assert.match(sql, /COALESCE/);
  assert.equal(postgresWhere({ ownerId: { $ne: null } }, []), 'TRUE');
  const id = new ObjectId();
  const idValues = [];
  assert.equal(
    postgresWhere({ $and: [{ _id: id }, { active: true }] }, idValues),
    "id = $1 AND COALESCE(doc #> '{active}', 'null'::jsonb) = $2::jsonb",
  );
  assert.equal(idValues.length, 2);
});
