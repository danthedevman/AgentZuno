import { listResponse } from './listQuery.js';
import {
  enterpriseUserSchema,
  workforceFromScim,
  importWorkforceProfile,
} from './workforceProfiles.js';
import { ObjectId } from 'mongodb';
import { randomBytes, createHash } from 'node:crypto';
import { requireRole, helpdeskScope, deny } from './helpdeskRoles.js';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const userSchema = 'urn:ietf:params:scim:schemas:core:2.0:User';
const scimUser = (record) => ({
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
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.userName)
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
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email) &&
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
export function installProvisioningRoutes(app, store) {
  app.get('/api/helpdesk/provisioning', async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const settings = await store
      .collection('identitySettings')
      .findOne({ ...helpdeskScope(user), enabled: true });
    const token = await store.collection('helpdeskProvisioningTokens').findOne({
      ...helpdeskScope(user),
      settingsVersion: settings?.updatedAt,
      expiresAt: { $gt: new Date() },
    });
    response.json({
      enabled: !!settings,
      canConfigure: user.isWorkspaceOwner,
      hasToken: !!token,
      scimUrl: `${process.env.APP_ORIGIN || 'http://localhost:3000'}/api/provisioning/${user.workspaceId}/scim/v2`,
    });
  });
  app.get('/api/helpdesk/directory-users', async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const records = await store
      .collection('helpdeskDirectoryUsers')
      .find({ workspaceId: user.workspaceId })
      .sort({ userName: 1 })
      .limit(request.query.list === '1' ? 0 : 200)
      .toArray();
    response.json(
      listResponse(
        request,
        records.map((record) => ({
          id: record._id.toHexString(),
          userName: record.userName,
          displayName: record.displayName,
          active: record.active,
          userId: record.userId || null,
          workforce: record.workforce || {},
          title: record.workforce?.title || '',
          department: record.workforce?.department || '',
          manager:
            records.find(
              (item) =>
                item.issuer === record.issuer &&
                item._id.toHexString() === record.workforce?.managerDirectoryId,
            )?.displayName || '',
        })),
        {
          User: (item) => item.displayName || item.userName,
          Title: 'title',
          Department: 'department',
          Manager: 'manager',
          Email: 'userName',
          userName: 'userName',
          Status: (item) => (item.active ? 'Active' : 'Disabled'),
          Account: (item) => (item.userId ? 'Account created' : 'Awaiting sign-in'),
        },
      ),
    );
  });
  app.post('/api/helpdesk/provisioning/token', async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    if (!user.isWorkspaceOwner)
      deny('Only the workspace owner can configure identity provisioning.');
    const settings = await store
      .collection('identitySettings')
      .findOne({ ...helpdeskScope(user), enabled: true });
    if (!settings) deny('Enable an identity provider first.', 422);
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 86400000);
    await store.collection('helpdeskProvisioningTokens').updateOne(
      helpdeskScope(user),
      {
        $set: {
          ...helpdeskScope(user),
          hash: hash(token),
          settingsVersion: settings.updatedAt,
          issuer: settings.issuer,
          expiresAt,
        },
      },
      { upsert: true },
    );
    response.json({ token, expiresAt });
  });
  const service = createProvisioningService(store);
  app.use('/api/provisioning/:workspaceId/scim/v2', async (request, response, next) => {
    await store.ready();
    const bearer = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!bearer) deny('Provisioning authorization required.', 401);
    const context = await store.collection('helpdeskProvisioningTokens').findOne({
      workspaceId: request.params.workspaceId,
      hash: hash(bearer),
      expiresAt: { $gt: new Date() },
    });
    if (!context) deny('Provisioning token is invalid or expired.', 401);
    const settings = await store.collection('identitySettings').findOne({
      workspaceId: context.workspaceId,
      ownerId: context.ownerId,
      enabled: true,
      updatedAt: context.settingsVersion,
    });
    if (!settings) deny('Identity provisioning configuration changed.', 401);
    request.provisioningContext = context;
    next();
  });
  const root = '/api/provisioning/:workspaceId/scim/v2';
  app.get(`${root}/ServiceProviderConfig`, (request, response) =>
    response.json({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 100 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'Provisioning bearer token',
          description: 'Workspace-bound token',
        },
      ],
    }),
  );
  app.get(`${root}/Users`, async (request, response) => {
    const filter = {
      workspaceId: request.provisioningContext.workspaceId,
      issuer: request.provisioningContext.issuer,
    };
    if (request.query.filter) {
      const match = String(request.query.filter).match(
        /^(userName|externalId) eq "([^"\\]{1,500})"$/,
      );
      if (!match) deny('Unsupported SCIM filter.', 400);
      filter[match[1]] = match[1] === 'userName' ? match[2].toLowerCase() : match[2];
    }
    const startIndex = Number(request.query.startIndex || 1);
    const count = Number(request.query.count ?? 100);
    if (
      !Number.isInteger(startIndex) ||
      startIndex < 1 ||
      startIndex > 10000 ||
      !Number.isInteger(count) ||
      count < 0 ||
      count > 100
    )
      deny('Invalid pagination.', 400);
    const collection = store.collection('helpdeskDirectoryUsers');
    const records = count
      ? await collection
          .find(filter)
          .sort({ _id: 1 })
          .skip(startIndex - 1)
          .limit(count)
          .toArray()
      : [];
    response.json({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: await collection.countDocuments(filter),
      startIndex,
      itemsPerPage: records.length,
      Resources: records.map(scimUser),
    });
  });
  app.post(`${root}/Users`, async (request, response) =>
    response.status(201).json(await service.apply(request.provisioningContext, null, request.body)),
  );
  app.get(`${root}/Users/:id`, async (request, response) => {
    const record =
      ObjectId.isValid(request.params.id) &&
      (await store.collection('helpdeskDirectoryUsers').findOne({
        _id: new ObjectId(request.params.id),
        workspaceId: request.provisioningContext.workspaceId,
        issuer: request.provisioningContext.issuer,
      }));
    if (!record) deny('Directory user not found.', 404);
    response.json(scimUser(record));
  });
  app.put(`${root}/Users/:id`, async (request, response) =>
    response.json(
      await service.apply(request.provisioningContext, request.params.id, request.body),
    ),
  );
  app.patch(`${root}/Users/:id`, async (request, response) => {
    const input = request.body;
    if (!Array.isArray(input?.Operations) || input.Operations.length > 20)
      deny('Invalid SCIM operations.', 400);
    const changes = {};
    for (const operation of input.Operations) {
      if (!['add', 'replace'].includes(operation.op?.toLowerCase()))
        deny('Unsupported SCIM operation.', 400);
      if (operation.path) {
        const enterpriseKey = operation.path.startsWith(enterpriseUserSchema + ':')
          ? operation.path.slice(enterpriseUserSchema.length + 1)
          : null;
        if (
          enterpriseKey &&
          [
            'employeeNumber',
            'costCenter',
            'organization',
            'division',
            'department',
            'manager',
          ].includes(enterpriseKey)
        ) {
          changes[enterpriseUserSchema] = {
            ...(changes[enterpriseUserSchema] || {}),
            [enterpriseKey]: operation.value,
          };
        } else {
          if (
            ![
              'active',
              'userName',
              'displayName',
              'name',
              'title',
              'locale',
              'timezone',
              'phoneNumbers',
              'addresses',
              enterpriseUserSchema,
            ].includes(operation.path)
          )
            deny('Unsupported SCIM path.', 400);
          changes[operation.path] = operation.value;
        }
      } else {
        if (
          !operation.value ||
          Object.keys(operation.value).some(
            (key) =>
              ![
                'active',
                'userName',
                'displayName',
                'name',
                'title',
                'locale',
                'timezone',
                'phoneNumbers',
                'addresses',
                enterpriseUserSchema,
              ].includes(key),
          )
        )
          deny('Unsupported SCIM changes.', 400);
        Object.assign(changes, operation.value);
      }
    }
    response.json(await service.apply(request.provisioningContext, request.params.id, changes));
  });
  app.delete(`${root}/Users/:id`, async (request, response) => {
    await service.apply(request.provisioningContext, request.params.id, { active: false });
    response.status(204).end();
  });
}
