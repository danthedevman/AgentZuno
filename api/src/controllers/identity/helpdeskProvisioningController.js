import { listResponse } from '../../shared/listQuery.js';
import { enterpriseUserSchema } from '../../identity/workforceProfiles.js';
import { ObjectId } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { requireRole, helpdeskScope, deny } from '../../identity/helpdeskRoles.js';
import { hash, scimUser, createProvisioningService } from '../../identity/helpdeskProvisioning.js';
export function createHelpdeskProvisioningController(store) {
  const service = createProvisioningService(store);
  const root = '/api/provisioning/:workspaceId/scim/v2';
  const getProvisioning = async (request, response) => {
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
  };
  const getDirectoryUsers = async (request, response) => {
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
  };
  const postProvisioningToken = async (request, response) => {
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
  };
  const useApiProvisioningWorkspaceIdScimV2 = async (request, response, next) => {
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
  };
  const getRootServiceProviderConfig = (request, response) =>
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
    });
  const getRootUsers = async (request, response) => {
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
  };
  const postRootUsers = async (request, response) =>
    response.status(201).json(await service.apply(request.provisioningContext, null, request.body));
  const getRootUsersId = async (request, response) => {
    const record =
      ObjectId.isValid(request.params.id) &&
      (await store.collection('helpdeskDirectoryUsers').findOne({
        _id: new ObjectId(request.params.id),
        workspaceId: request.provisioningContext.workspaceId,
        issuer: request.provisioningContext.issuer,
      }));
    if (!record) deny('Directory user not found.', 404);
    response.json(scimUser(record));
  };
  const putRootUsersId = async (request, response) =>
    response.json(
      await service.apply(request.provisioningContext, request.params.id, request.body),
    );
  const patchRootUsersId = async (request, response) => {
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
  };
  const deleteRootUsersId = async (request, response) => {
    await service.apply(request.provisioningContext, request.params.id, { active: false });
    response.status(204).end();
  };
  return {
    getProvisioning,
    getDirectoryUsers,
    postProvisioningToken,
    useApiProvisioningWorkspaceIdScimV2,
    getRootServiceProviderConfig,
    getRootUsers,
    postRootUsers,
    getRootUsersId,
    putRootUsersId,
    patchRootUsersId,
    deleteRootUsersId,
    root,
  };
}
