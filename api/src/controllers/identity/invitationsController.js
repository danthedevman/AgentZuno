import { queryString, queryVersion } from '../../shared/queryValues.js';
import { ObjectId } from 'mongodb';
import { isEmailAddress } from '../../shared/emailAddress.js';
import { listResponse } from '../../shared/listQuery.js';
import { randomBytes } from 'node:crypto';

import { smtpConfiguration } from '../../channels/smtpSettings.js';
import { encryptSecret } from '../../shared/secrets.js';
import { deny, helpdeskScope, requireRole, validateMember } from '../../identity/helpdeskRoles.js';
import { requireExistingQueues } from '../../identity/helpdeskQueues.js';
import { hash } from '../../identity/invitations.js';
export function createInvitationsController(store) {
  const postInvitations = async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const input = request.body || {};
    const value = validateMember(input);
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (!isEmailAddress(email) || email.length > 254 || !value.active)
      deny('Provide an email address and an active membership.', 400);
    if (
      await store.collection('identitySettings').findOne({ ...helpdeskScope(user), enabled: true })
    )
      deny('Users are managed by the identity provider.', 409);
    const canEmail = !!(await smtpConfiguration(store, helpdeskScope(user)));
    await requireExistingQueues(store, user, value.queues);
    const count = await store
      .collection('helpdeskMembers')
      .countDocuments({ workspaceId: queryString(user.workspaceId) });
    if (count >= 200) deny('Workspace membership limit reached.', 422);
    const target = await store.collection('users').findOne({ email: queryString(email, 254) });
    if (
      target &&
      (await store
        .collection('helpdeskMembers')
        .findOne({ workspaceId: queryString(user.workspaceId), userId: queryString(target.id) }))
    )
      deny('This user is already a workspace member.', 409);
    if (
      (await store.collection('workspaceInvitations').countDocuments({
        ...helpdeskScope(user),
        status: 'pending',
        expiresAt: { $gt: new Date() },
      })) >= 100
    )
      deny('Pending invitation limit reached.', 422);
    if (
      await store.collection('workspaceInvitations').findOne({
        ...helpdeskScope(user),
        email: queryString(email, 254),
        status: 'pending',
        expiresAt: { $gt: new Date() },
      })
    )
      deny('An invitation is already pending for this email address.', 409);
    const token = randomBytes(32).toString('hex');
    const origin = new URL(process.env.APP_ORIGIN || 'http://localhost:3000');
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password)
      deny('Configure the application origin.', 503);
    const invitationUrl = `${origin.origin}/invite#${token}`;
    const text = `You have been invited to an AgentZuno workspace as ${value.role === 'read-only' ? 'Read Only' : value.role}. Sign in or register with ${email}, then accept this invitation:\n\n${origin.origin}/invite#${token}\n\nThis invitation expires in 7 days.`;
    const record = {
      ...helpdeskScope(user),
      email,
      ...value,
      invitedBy: user.id,
      tokenHash: hash(token),
      ...(canEmail ? { message: encryptSecret(JSON.stringify({ text })) } : {}),
      status: 'pending',
      version: 1,
      delivery: canEmail ? 'queued' : 'manual',
      createdAt: new Date(),
      nextAttemptAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 86400000),
    };
    const result = await store.collection('workspaceInvitations').insertOne(record);
    response.status(202).json({
      id: result.insertedId.toHexString(),
      email,
      status: 'pending',
      delivery: canEmail ? 'queued' : 'manual',
      ...(canEmail ? {} : { invitationUrl }),
    });
  };
  async function currentInvitation(request) {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    if (typeof request.params.id !== 'string' || !/^[a-f0-9]{24}$/.test(request.params.id))
      deny('Invalid invitation.', 400);
    if (
      await store.collection('identitySettings').findOne({ ...helpdeskScope(user), enabled: true })
    )
      deny('Users are managed by the identity provider.', 409);
    const invitation = await store.collection('workspaceInvitations').findOne({
      ...helpdeskScope(user),
      _id: new ObjectId(request.params.id),
      status: 'pending',
    });
    if (!invitation) deny('Pending invitation not found.', 404);
    if (invitation.delivery === 'sending')
      deny('Email delivery is in progress. Try again shortly.', 409);
    if (queryVersion(request.body?.version) !== (invitation.version || 0))
      deny('Invitation changed. Reload and try again.', 409);
    return invitation;
  }
  const invitationFilter = (user, invitation) => ({
    ...helpdeskScope(user),
    _id: invitation._id,
    status: 'pending',
    delivery: { $ne: 'sending' },
    tokenHash: queryString(invitation.tokenHash, 64),
    version:
      invitation.version === undefined ? { $exists: false } : queryVersion(invitation.version),
  });
  const postInvitationResend = async (request, response) => {
    const input = request.body || {};
    if (
      Object.keys(input).some((key) => !['mode', 'version'].includes(key)) ||
      !['link', 'email'].includes(input.mode)
    )
      deny('Choose a new link or email delivery.', 400);
    const invitation = await currentInvitation(request);
    const user = request.helpdeskUser;
    await requireExistingQueues(store, user, invitation.queues || []);
    if (input.mode === 'email' && !(await smtpConfiguration(store, helpdeskScope(user))))
      deny('Configure outgoing email before resending by email.', 409);
    const token = randomBytes(32).toString('hex');
    const origin = new URL(process.env.APP_ORIGIN || 'http://localhost:3000');
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password)
      deny('Configure the application origin.', 503);
    const invitationUrl = `${origin.origin}/invite#${token}`;
    const now = new Date();
    const values = {
      tokenHash: hash(token),
      version: (invitation.version || 0) + 1,
      invitedBy: user.id,
      delivery: input.mode === 'email' ? 'queued' : 'manual',
      nextAttemptAt: now,
      expiresAt: new Date(Date.now() + 7 * 86400000),
      updatedAt: now,
      ...(input.mode === 'email'
        ? {
            message: encryptSecret(
              JSON.stringify({
                text: `You have been invited to an AgentZuno workspace. Sign in or register with ${invitation.email}, then accept this invitation:\n\n${invitationUrl}\n\nThis invitation expires in 7 days.`,
              }),
            ),
          }
        : {}),
    };
    const result = await store
      .collection('workspaceInvitations')
      .updateOne(invitationFilter(user, invitation), {
        $set: values,
        $unset: {
          ...(input.mode === 'link' ? { message: '' } : {}),
          sentAt: '',
          failedAt: '',
          attemptedAt: '',
        },
      });
    if (!result.matchedCount) deny('Invitation changed. Reload and try again.', 409);
    response.status(202).json({
      id: String(invitation._id),
      delivery: values.delivery,
      ...(input.mode === 'link' ? { invitationUrl } : {}),
    });
  };
  const deleteInvitation = async (request, response) => {
    if (
      request.body?.confirmed !== true ||
      Object.keys(request.body).some((key) => !['confirmed', 'version'].includes(key))
    )
      deny('Confirm removal of this invitation.', 400);
    const invitation = await currentInvitation(request);
    const result = await store
      .collection('workspaceInvitations')
      .updateOne(invitationFilter(request.helpdeskUser, invitation), {
        $set: {
          status: 'revoked',
          delivery: 'cancelled',
          revokedAt: new Date(),
          revokedBy: request.helpdeskUser.id,
          version: (invitation.version || 0) + 1,
        },
        $unset: { tokenHash: '', message: '' },
      });
    if (!result.matchedCount) deny('Invitation changed. Reload and try again.', 409);
    response.json({ removed: true });
  };
  const getInvitations = async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    const canEmail = !!(await smtpConfiguration(store, helpdeskScope(request.helpdeskUser)));
    const rows = await store
      .collection('workspaceInvitations')
      .find(
        { ...helpdeskScope(request.helpdeskUser), status: { $ne: 'revoked' } },
        {
          projection: {
            email: 1,
            role: 1,
            status: 1,
            delivery: 1,
            expiresAt: 1,
            createdAt: 1,
            version: 1,
          },
        },
      )
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    response.json(
      listResponse(
        request,
        rows.map(({ _id, ...row }) => ({
          id: _id.toHexString(),
          ...row,
          version: row.version || 0,
          canEmail,
        })),
        {
          Email: 'email',
          Role: 'role',
          Status: 'status',
          Delivery: 'delivery',
          Expires: 'expiresAt',
        },
      ),
    );
  };
  const postInvitationsAccept = async (request, response) => {
    const token = request.body?.token;
    if (
      typeof token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(token) ||
      Object.keys(request.body).some((key) => key !== 'token')
    )
      deny('Invalid invitation.', 400);
    const invitation = await store.collection('workspaceInvitations').findOne({
      tokenHash: hash(token),
      expiresAt: { $gt: new Date() },
      status: { $in: ['pending', 'accepting', 'accepted'] },
    });
    if (!invitation || invitation.email !== request.user.email.toLowerCase())
      deny('Sign in with the invited email address to accept this invitation.', 403);
    if (
      await store.collection('identitySettings').findOne({
        ownerId: invitation.ownerId,
        workspaceId: invitation.workspaceId,
        enabled: true,
      })
    )
      deny('Users are managed by the identity provider.', 409);
    const inviter = await store.collection('helpdeskMembers').findOne({
      workspaceId: invitation.workspaceId,
      userId: invitation.invitedBy,
      role: 'admin',
      active: true,
    });
    if (!inviter) deny('This invitation is no longer authorized.', 403);
    if (invitation.status === 'accepted' && invitation.acceptedBy !== request.user.id)
      deny('Invitation already accepted.', 409);
    const filter = { workspaceId: invitation.workspaceId, userId: request.user.id };
    const existing = await store.collection('helpdeskMembers').findOne(filter);
    if (existing && existing.invitationId !== invitation._id.toHexString())
      deny('You already belong to this workspace.', 409);
    const claim = await store.collection('workspaceInvitations').updateOne(
      {
        _id: invitation._id,
        tokenHash: hash(token),
        expiresAt: { $gt: new Date() },
        status: { $in: ['pending', 'accepting'] },
        $or: [{ acceptedBy: { $exists: false } }, { acceptedBy: request.user.id }],
      },
      { $set: { status: 'accepting', acceptedBy: request.user.id } },
    );
    if (!claim.matchedCount && invitation.status !== 'accepted')
      deny('Invitation changed. Please retry.', 409);
    await store.collection('helpdeskMembers').updateOne(
      filter,
      {
        $setOnInsert: {
          ...filter,
          ownerId: invitation.ownerId,
          email: invitation.email,
          role: invitation.role,
          queues: invitation.queues,
          canApprove: invitation.role !== 'read-only' && invitation.canApprove,
          active: true,
          version: 1,
          invitationId: invitation._id.toHexString(),
          createdAt: new Date(),
          updatedAt: new Date(),
          updatedBy: invitation.invitedBy,
        },
      },
      { upsert: true },
    );
    await store
      .collection('workspaceInvitations')
      .updateOne(
        { _id: invitation._id, acceptedBy: request.user.id },
        { $set: { status: 'accepted', acceptedAt: new Date() }, $unset: { message: '' } },
      );
    response.json({ workspaceId: invitation.workspaceId, role: invitation.role });
  };
  return {
    postInvitations,
    getInvitations,
    postInvitationsAccept,
    postInvitationResend,
    deleteInvitation,
  };
}
