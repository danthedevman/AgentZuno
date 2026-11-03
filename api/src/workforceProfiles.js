import { userReferenceOptions } from './userReferences.js';
import { ObjectId } from 'mongodb';
import { createHash } from 'node:crypto';
import { helpdeskScope, requireRole, deny } from './helpdeskRoles.js';
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
function bounded(value, max = 160) {
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
export function installWorkforceRoutes(app, store) {
  async function target(user, id) {
    if (id !== user.id) requireRole(user, ['admin']);
    const member = await store
      .collection('helpdeskMembers')
      .findOne({ workspaceId: user.workspaceId, userId: id });
    if (!member || member.ownerId !== helpdeskScope(user).ownerId) deny('User not found.', 404);
    return member;
  }
  async function present(user, id) {
    const member = await target(user, id);
    const record = await store
      .collection('workforceProfiles')
      .findOne({ ...helpdeskScope(user), userId: id });
    const account = await store
      .collection('users')
      .findOne({ id }, { projection: { name: 1, displayEmail: 1, email: 1 } });
    const fields = Object.fromEntries(
      [...profileTextFields, ...referenceTypes, 'manager'].map((key) => [key, record?.[key] || '']),
    );
    if (
      !fields.manager &&
      record?.managerDirectoryId &&
      ObjectId.isValid(record.managerDirectoryId)
    ) {
      const manager = await store.collection('helpdeskDirectoryUsers').findOne({
        workspaceId: user.workspaceId,
        issuer: record.issuer,
        _id: new ObjectId(record.managerDirectoryId),
      });
      fields.manager = manager?.userId || '';
    }
    const references = await store
      .collection('workforceReferences')
      .find({
        ...helpdeskScope(user),
        _id: { $in: referenceTypes.map((key) => fields[key]).filter(Boolean) },
      })
      .toArray();
    const manager = fields.manager
      ? await store.collection('helpdeskMembers').findOne({
          workspaceId: user.workspaceId,
          ownerId: helpdeskScope(user).ownerId,
          userId: fields.manager,
        })
      : null;
    return {
      userId: id,
      name: account?.name || member.email,
      email: account?.displayEmail || member.email,
      fields,
      labels: {
        ...Object.fromEntries(references.map((item) => [item._id, item.name])),
        ...(manager ? { [manager.userId]: manager.email } : {}),
      },
      source: record?.source || 'local',
      version: record?.version || 0,
      canEdit: (user.role === 'admin' || user.id === id) && record?.source !== 'identity-provider',
      canEditFields: user.role === 'admin' && record?.source !== 'identity-provider',
      updatedAt: record?.updatedAt || null,
    };
  }
  app.get('/api/helpdesk/workforce-profiles', async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const members = await store
      .collection('helpdeskMembers')
      .find({ workspaceId: user.workspaceId, ownerId: helpdeskScope(user).ownerId })
      .limit(200)
      .toArray();
    response.json(await Promise.all(members.map((member) => present(user, member.userId))));
  });
  app.get('/api/helpdesk/workforce-profiles/:id', async (request, response) =>
    response.json(await present(request.helpdeskUser, request.params.id)),
  );
  app.get('/api/helpdesk/reference-records', async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const [references, members] = await Promise.all([
      store
        .collection('workforceReferences')
        .find(helpdeskScope(user))
        .sort({ name: 1 })
        .limit(1000)
        .toArray(),
      userReferenceOptions(store, user),
    ]);
    response.json({
      references: references.map(({ _id, type, name }) => ({ id: _id, type, name })),
      users: members.map(({ value, label }) => ({ id: value, name: label })),
    });
  });
  app.post('/api/helpdesk/reference-records', async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    const input = request.body;
    if (!input || Object.keys(input).some((key) => !['type', 'name'].includes(key)))
      deny('Invalid reference fields.', 400);
    response
      .status(201)
      .json(await saveReference(store, request.helpdeskUser, input.type, input.name));
  });
  app.put('/api/helpdesk/workforce-profiles/:id', async (request, response) => {
    const user = request.helpdeskUser;
    const current = await present(user, request.params.id);
    if (!current.canEdit) deny('This profile is managed by the identity provider.');
    const input = request.body;
    let name;
    if (input && Object.hasOwn(input, 'name')) {
      name = bounded(input.name, 160);
      if (!name) deny('Enter your name.', 400);
    }
    if (!current.canEditFields) {
      if (
        !input ||
        name === undefined ||
        Object.keys(input).some((key) => !['name', 'version'].includes(key))
      )
        deny('Only your name can be changed.', 403);
      if (input.version !== current.version) deny('Profile changed. Reload before saving.', 409);
      await store
        .collection('users')
        .updateOne({ id: user.id }, { $set: { name, updatedAt: new Date() } });
      return response.json(await present(user, request.params.id));
    }
    if (
      !input ||
      !Number.isInteger(input.version) ||
      !input.fields ||
      Array.isArray(input.fields) ||
      typeof input.fields !== 'object' ||
      Object.keys(input).some((key) => !['version', 'fields', 'name'].includes(key)) ||
      Object.keys(input.fields).some(
        (key) => ![...profileTextFields, ...referenceTypes, 'manager'].includes(key),
      )
    )
      deny('Invalid profile fields.', 400);
    if (current.version !== input.version) deny('Profile changed. Reload before saving.', 409);
    const values = {};
    for (const key of profileTextFields) values[key] = bounded(input.fields[key] ?? '');
    for (const key of referenceTypes) {
      const id = bounded(input.fields[key] ?? '', 24);
      if (
        id &&
        !(await store
          .collection('workforceReferences')
          .findOne({ _id: id, ...helpdeskScope(user), type: key }))
      )
        deny('Choose an available reference record.', 400);
      values[key] = id;
    }
    values.manager = bounded(input.fields.manager ?? '', 24);
    if (values.manager === request.params.id) deny('A user cannot be their own manager.', 400);
    if (
      values.manager &&
      !(await store.collection('helpdeskMembers').findOne({
        workspaceId: user.workspaceId,
        ownerId: helpdeskScope(user).ownerId,
        userId: values.manager,
        active: true,
      }))
    )
      deny('Choose an active manager in this workspace.', 400);
    const filter = { ...helpdeskScope(user), userId: request.params.id };
    if (input.version === 0) {
      const id = `${user.workspaceId}:${request.params.id}`;
      try {
        await store.collection('workforceProfiles').insertOne({
          _id: id,
          ...filter,
          ...values,
          source: 'local',
          version: 1,
          updatedAt: new Date(),
        });
      } catch (error) {
        if (error.code === 11000) deny('Profile changed. Reload before saving.', 409);
        throw error;
      }
    } else {
      const updated = await store
        .collection('workforceProfiles')
        .updateOne(
          { ...filter, version: input.version, source: 'local' },
          { $set: { ...values, updatedAt: new Date() }, $inc: { version: 1 } },
        );
      if (!updated.matchedCount) deny('Profile changed. Reload before saving.', 409);
    }
    if (name !== undefined)
      await store
        .collection('users')
        .updateOne({ id: request.params.id }, { $set: { name, updatedAt: new Date() } });
    response.json(await present(user, request.params.id));
  });
}
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
