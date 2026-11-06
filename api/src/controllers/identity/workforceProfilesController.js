import { isTimeZone } from '../../shared/timezones.js';
import { requireCompatibleDemoReferences } from '../../demo/demoReferences.js';
import { userReferenceOptions } from '../../identity/userReferences.js';
import { ObjectId } from 'mongodb';

import { helpdeskScope, requireRole, deny } from '../../identity/helpdeskRoles.js';
import {
  saveReference,
  coverThemes,
  bounded,
  profileTextFields,
  referenceTypes,
} from '../../identity/workforceProfiles.js';
export function createWorkforceProfilesController(store) {
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
      .findOne({ id }, { projection: { name: 1, displayEmail: 1, email: 1, timezone: 1 } });
    const fields = Object.fromEntries(
      [...profileTextFields, ...referenceTypes, 'manager'].map((key) => [key, record?.[key] || '']),
    );
    fields.timezone ||= account?.timezone || 'UTC';
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
    const cover = await store
      .collection('profileCoverPreferences')
      .findOne({ ...helpdeskScope(user), userId: id });
    return {
      coverTheme: coverThemes.some((theme) => theme.id === cover?.theme) ? cover.theme : 'ocean',
      coverThemes,
      canEditCover: user.role !== 'read-only' && (user.role === 'admin' || user.id === id),
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
  const getWorkforceProfiles = async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const members = await store
      .collection('helpdeskMembers')
      .find({ workspaceId: user.workspaceId, ownerId: helpdeskScope(user).ownerId })
      .limit(200)
      .toArray();
    response.json(await Promise.all(members.map((member) => present(user, member.userId))));
  };
  const getWorkforceProfilesId = async (request, response) =>
    response.json(await present(request.helpdeskUser, request.params.id));
  const getReferenceRecords = async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const [references, members] = await Promise.all([
      store
        .collection('workforceReferences')
        .find({
          ...helpdeskScope(user),
          ...(request.query.includeDemo === '1' ? {} : { demoDatasetId: { $exists: false } }),
        })
        .sort({ name: 1 })
        .limit(1000)
        .toArray(),
      userReferenceOptions(store, user, request.query.includeDemo === '1'),
    ]);
    response.json({
      references: references.map(({ _id, type, name }) => ({ id: _id, type, name })),
      users: members.map(({ value, label }) => ({ id: value, name: label })),
    });
  };
  const postReferenceRecords = async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    const input = request.body;
    if (!input || Object.keys(input).some((key) => !['type', 'name'].includes(key)))
      deny('Invalid reference fields.', 400);
    response
      .status(201)
      .json(await saveReference(store, request.helpdeskUser, input.type, input.name));
  };
  const putWorkforceProfilesIdCover = async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin', 'agent', 'user']);
    await target(user, request.params.id);
    if (
      !request.body ||
      Object.keys(request.body).some((key) => key !== 'theme') ||
      !coverThemes.some((theme) => theme.id === request.body.theme)
    )
      deny('Choose a profile cover theme.', 400);
    await store
      .collection('profileCoverPreferences')
      .updateOne(
        { ...helpdeskScope(user), userId: request.params.id },
        { $set: { theme: request.body.theme, updatedAt: new Date() } },
        { upsert: true },
      );
    response.json({ theme: request.body.theme });
  };
  const putWorkforceProfilesId = async (request, response) => {
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
    if (values.timezone && !isTimeZone(values.timezone)) deny('Choose a valid timezone.', 400);
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
    const member = await store
      .collection('helpdeskMembers')
      .findOne({ ...helpdeskScope(user), userId: request.params.id });
    await requireCompatibleDemoReferences(store, user, member, values);
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
  };
  return {
    getWorkforceProfiles,
    getWorkforceProfilesId,
    getReferenceRecords,
    postReferenceRecords,
    putWorkforceProfilesIdCover,
    putWorkforceProfilesId,
  };
}
