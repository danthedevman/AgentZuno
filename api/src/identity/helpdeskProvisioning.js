import { isEmailAddress } from '../shared/emailAddress.js';

import {
  enterpriseUserSchema,
  workforceFromScim,
  importWorkforceProfile,
} from './workforceProfiles.js';
import { ObjectId } from 'mongodb';
import { createHash } from 'node:crypto';
import { deny } from './helpdeskRoles.js';
export const hash = (value) => createHash('sha256').update(value).digest('hex');
const userSchema = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const scimUser = (record) => ({
  schemas: [userSchema, enterpriseUserSchema],
  title: record.workforce?.title || '',
  name: {
    givenName: record.workforce?.givenName || '',
    familyName: record.workforce?.familyName || '',
  },
  [enterpriseUserSchema]: Object.fromEntries(
    ['employeeNumber', 'department', 'division', 'organization', 'costCenter']
      .filter((key) => record.workforce?.[key])
      .map((key) => [key, record.workforce[key]]),
  ),
  id: record._id.toHexString(),
  userName: record.userName,
  externalId: record.externalId,
  displayName: record.displayName,
  active: record.active,
  meta: { resourceType: 'User', created: record.createdAt, lastModified: record.updatedAt },
});
function normalize(input, previous = {}) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          'schemas',
          'id',
          'meta',
          'userName',
          'externalId',
          'displayName',
          'name',
          'emails',
          'active',
          'password',
          'title',
          'locale',
          'timezone',
          'phoneNumbers',
          'addresses',
          enterpriseUserSchema,
        ].includes(key),
    ) ||
    input.password !== undefined
  )
    deny('Unsupported provisioning fields.', 400);
  const value = { ...previous, ...input };
  if (
    typeof value.userName !== 'string' ||
    value.userName.length > 254 ||
    !isEmailAddress(value.userName)
  )
    deny('Provide a valid userName email.', 400);
  if (
    value.externalId !== undefined &&
    (typeof value.externalId !== 'string' || !value.externalId || value.externalId.length > 500)
  )
    deny('Invalid externalId.', 400);
  if (
    value.displayName !== undefined &&
    (typeof value.displayName !== 'string' || value.displayName.length > 160)
  )
    deny('Invalid display name.', 400);
  if (value.active !== undefined && typeof value.active !== 'boolean')
    deny('Invalid active state.', 400);
  return {
    userName: value.userName.trim().toLowerCase(),
    externalId: value.externalId || null,
    displayName: value.displayName || value.userName,
    active: value.active ?? true,
    workforce: workforceFromScim(input, previous.workforce || {}),
  };
}
export async function provisionIdentityUser(store, settings, claims) {
  if (!settings.enabled || !settings.autoProvision)
    deny('Automatic employee provisioning is disabled. Ask an Admin for access.');
  if (
    typeof claims.sub !== 'string' ||
    !claims.sub ||
    claims.sub.length > 500 ||
    claims.iss !== settings.issuer
  )
    deny('Identity could not be verified.', 401);
  const key = { workspaceId: settings.workspaceId, issuer: settings.issuer, subject: claims.sub };
  let identity = await store.collection('helpdeskIdentities').findOne(key);
  let directory = await store.collection('helpdeskDirectoryUsers').findOne({
    workspaceId: settings.workspaceId,
    issuer: settings.issuer,
    externalId: claims.sub,
  });
  const email =
    claims.email_verified === true &&
    typeof claims.email === 'string' &&
    isEmailAddress(claims.email) &&
    claims.email.length <= 254
      ? claims.email.toLowerCase()
      : null;
  if (!directory && email)
    directory = await store
      .collection('helpdeskDirectoryUsers')
      .findOne({ workspaceId: settings.workspaceId, issuer: settings.issuer, userName: email });
  if (directory && (!directory.active || (directory.subject && directory.subject !== claims.sub)))
    deny('Your directory account is disabled or bound to a different identity.');
  if (!identity) {
    const id = hash(`${settings.workspaceId}\n${settings.issuer}\n${claims.sub}`).slice(0, 24);
    const user = {
      id,
      workspaceId: new ObjectId().toHexString(),
      email: `${id}@identity.agentzuno.invalid`,
      displayEmail: email || directory?.userName || 'Enterprise account',
      name:
        typeof claims.name === 'string'
          ? claims.name.slice(0, 160)
          : directory?.displayName || 'Employee',
      identityOnly: true,
      createdAt: new Date(),
    };
    // Subject binding creates a separate enterprise principal. Existing local accounts are never linked by email.
    await store.collection('users').updateOne({ id }, { $setOnInsert: user }, { upsert: true });
    await store
      .collection('helpdeskIdentities')
      .updateOne(
        key,
        { $setOnInsert: { ...key, userId: id, createdAt: new Date() } },
        { upsert: true },
      );
    identity = await store.collection('helpdeskIdentities').findOne(key);
  }
  const user = await store.collection('users').findOne({ id: identity.userId });
  if (!user) deny('Enterprise account is unavailable.');
  if (directory) {
    const binding = await store.collection('helpdeskDirectoryUsers').updateOne(
      {
        _id: directory._id,
        active: true,
        $or: [{ subject: { $exists: false } }, { subject: claims.sub }],
      },
      { $set: { subject: claims.sub, userId: user.id, updatedAt: new Date() } },
    );
    if (!binding.matchedCount) deny('Directory identity binding changed.');
  }
  await store.collection('helpdeskMembers').updateOne(
    { workspaceId: settings.workspaceId, userId: user.id },
    {
      $setOnInsert: {
        workspaceId: settings.workspaceId,
        ownerId: settings.ownerId,
        userId: user.id,
        email: user.displayEmail || user.email,
        role: 'user',
        queues: [],
        canApprove: false,
        active: true,
        version: 1,
        identityIssuer: settings.issuer,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
  const member = await store
    .collection('helpdeskMembers')
    .findOne({ workspaceId: settings.workspaceId, userId: user.id });
  if (!member?.active) deny('Your help desk access is disabled.');
  await store.collection('helpdeskMembershipHistory').insertOne({
    workspaceId: settings.workspaceId,
    ownerId: settings.ownerId,
    actorId: 'identity-provider',
    targetUserId: user.id,
    action: 'identity-sign-in',
    role: member.role,
    at: new Date(),
  });
  const workforce =
    directory?.workforce ||
    workforceFromScim({
      name: {
        givenName: typeof claims.given_name === 'string' ? claims.given_name : '',
        familyName: typeof claims.family_name === 'string' ? claims.family_name : '',
      },
      locale: typeof claims.locale === 'string' ? claims.locale : '',
      timezone: typeof claims.zoneinfo === 'string' ? claims.zoneinfo : '',
    });
  await importWorkforceProfile(
    store,
    settings,
    user.id,
    workforce,
    directory?._id?.toHexString() || null,
  );
  return user;
}
export function createProvisioningService(store) {
  async function apply(context, id, input) {
    const collection = store.collection('helpdeskDirectoryUsers');
    const filter = { workspaceId: context.workspaceId, issuer: context.issuer };
    const previous =
      id && ObjectId.isValid(id)
        ? await collection.findOne({ ...filter, _id: new ObjectId(id) })
        : null;
    if (id && !previous) deny('Directory user not found.', 404);
    const value = normalize(input, previous || {});
    if (previous?.subject && value.externalId !== previous.externalId)
      deny('A bound external identity cannot be changed.', 409);
    const now = new Date();
    let record;
    if (previous) {
      record = await collection.findOneAndUpdate(
        { _id: previous._id, ...filter },
        { $set: { ...value, updatedAt: now } },
        { returnDocument: 'after' },
      );
    } else {
      record = { ...filter, ...value, createdAt: now, updatedAt: now };
      try {
        record._id = (await collection.insertOne(record)).insertedId;
      } catch (error) {
        if (error.code === 11000) deny('Directory user already exists.', 409);
        throw error;
      }
    }
    if (record.userId) {
      await importWorkforceProfile(
        store,
        context,
        record.userId,
        record.workforce || {},
        record._id.toHexString(),
      );
      await store
        .collection('helpdeskMembers')
        .updateOne(
          { workspaceId: context.workspaceId, userId: record.userId },
          { $set: { active: record.active, updatedAt: now }, $inc: { version: 1 } },
        );
      if (!record.active)
        await store.collection('helpdeskMembershipHistory').insertOne({
          workspaceId: context.workspaceId,
          ownerId: context.ownerId,
          actorId: 'identity-provider',
          targetUserId: record.userId,
          action: 'deactivated',
          at: now,
        });
    }
    return scimUser(record);
  }
  return { apply };
}
