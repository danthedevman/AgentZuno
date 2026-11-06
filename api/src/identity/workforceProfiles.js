import { ObjectId } from 'mongodb';
import { createHash } from 'node:crypto';
import { helpdeskScope, deny } from './helpdeskRoles.js';
export const referenceTypes = ['department', 'location', 'organization', 'division', 'costCenter'];
export const profileTextFields = [
  'givenName',
  'familyName',
  'preferredName',
  'title',
  'employeeNumber',
  'employeeType',
  'workPhone',
  'mobilePhone',
  'streetAddress',
  'city',
  'region',
  'postalCode',
  'country',
  'locale',
  'timezone',
];
export function bounded(value, max = 160) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/u.test(value))
    deny('Invalid profile field.', 400);
  return value.trim();
}
export async function saveReference(store, user, type, name) {
  if (!referenceTypes.includes(type)) deny('Unknown reference type.', 400);
  name = bounded(name);
  if (!name) deny('Enter a reference name.', 400);
  const scope = helpdeskScope(user);
  const id = createHash('sha256')
    .update(`${scope.ownerId}:${scope.workspaceId}:${type}:${name.toLowerCase()}`)
    .digest('hex')
    .slice(0, 24);
  await store
    .collection('workforceReferences')
    .updateOne(
      { _id: id, ...scope },
      { $setOnInsert: { ...scope, type, name, createdAt: new Date() } },
      { upsert: true },
    );
  return { id, type, name };
}
export async function importWorkforceProfile(store, context, userId, source, directory = null) {
  const scope = { ownerId: context.ownerId, workspaceId: context.workspaceId };
  const values = {};
  for (const key of profileTextFields)
    if (source[key] !== undefined) values[key] = bounded(source[key]);
  for (const key of referenceTypes)
    if (source[key] !== undefined)
      values[key] = source[key]
        ? (
            await saveReference(
              store,
              { id: context.ownerId, workspaceId: context.workspaceId },
              key,
              source[key],
            )
          ).id
        : '';
  if (source.managerDirectoryId !== undefined)
    values.managerDirectoryId = bounded(source.managerDirectoryId, 24);
  await store.collection('workforceProfiles').updateOne(
    { ...scope, userId },
    {
      $set: {
        ...scope,
        userId,
        ...values,
        source: 'identity-provider',
        issuer: context.issuer,
        directoryId: directory,
        updatedAt: new Date(),
      },
      $inc: { version: 1 },
    },
    { upsert: true },
  );
}
export const coverThemes = [
  { id: 'ocean', name: 'Ocean', colors: ['#152d47', '#255a77', '#173149'] },
  { id: 'violet', name: 'Violet', colors: ['#242042', '#818cf8', '#40345e'] },
  { id: 'forest', name: 'Forest', colors: ['#12362b', '#387a60', '#1c4440'] },
  { id: 'sunset', name: 'Sunset', colors: ['#492448', '#b56472', '#b88055'] },
  { id: 'slate', name: 'Slate', colors: ['#202a38', '#52647a', '#29374a'] },
];

export const enterpriseUserSchema = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
export function workforceFromScim(input, previous = {}) {
  const extension = input[enterpriseUserSchema] || {};
  if (
    !extension ||
    typeof extension !== 'object' ||
    Array.isArray(extension) ||
    Object.keys(extension).some(
      (key) =>
        ![
          'employeeNumber',
          'costCenter',
          'organization',
          'division',
          'department',
          'manager',
        ].includes(key),
    )
  )
    deny('Unsupported enterprise profile fields.', 400);
  const values = { ...previous };
  for (const key of ['title', 'locale', 'timezone'])
    if (input[key] !== undefined) values[key] = bounded(input[key]);
  if (input.name) {
    if (typeof input.name !== 'object' || Array.isArray(input.name)) deny('Invalid name.', 400);
    for (const key of ['givenName', 'familyName'])
      if (input.name[key] !== undefined) values[key] = bounded(input.name[key]);
  }
  for (const key of ['employeeNumber', 'costCenter', 'organization', 'division', 'department'])
    if (extension[key] !== undefined) values[key] = bounded(extension[key]);
  if (extension.manager !== undefined) {
    const manager = extension.manager;
    if (
      !manager ||
      typeof manager !== 'object' ||
      Array.isArray(manager) ||
      Object.keys(manager).some((key) => !['value', '$ref', 'displayName'].includes(key)) ||
      (manager.value && !ObjectId.isValid(manager.value))
    )
      deny('Invalid manager reference.', 400);
    values.managerDirectoryId = manager.value || '';
  }
  if (input.phoneNumbers !== undefined) {
    if (!Array.isArray(input.phoneNumbers) || input.phoneNumbers.length > 5)
      deny('Invalid phone numbers.', 400);
    for (const phone of input.phoneNumbers) {
      if (!phone || !['work', 'mobile'].includes(phone.type)) deny('Unsupported phone type.', 400);
      values[phone.type === 'work' ? 'workPhone' : 'mobilePhone'] = bounded(phone.value);
    }
  }
  if (input.addresses !== undefined) {
    if (!Array.isArray(input.addresses) || input.addresses.length > 3)
      deny('Invalid addresses.', 400);
    const address = input.addresses.find((item) => item?.type === 'work') || input.addresses[0];
    if (address)
      for (const [source, target] of [
        ['streetAddress', 'streetAddress'],
        ['locality', 'city'],
        ['region', 'region'],
        ['postalCode', 'postalCode'],
        ['country', 'country'],
      ])
        if (address[source] !== undefined) values[target] = bounded(address[source]);
  }
  return values;
}
