import { listResponse } from './listQuery.js';
import { randomBytes, createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { smtpConfiguration, smtpTransport } from './smtpSettings.js';
import { encryptSecret, decryptSecret } from './secrets.js';
import { deny, helpdeskScope, requireRole, validateMember } from './helpdeskRoles.js';
import { requireExistingQueues } from './helpdeskQueues.js';
const hash = (value) => createHash('sha256').update(value).digest('hex');
export function createInvitationDelivery(store, send) {
  return async function deliver() {
    const rows = await store
      .collection('workspaceInvitations')
      .find({
        status: 'pending',
        delivery: 'queued',
        expiresAt: { $gt: new Date() },
        nextAttemptAt: { $lte: new Date() },
      })
      .limit(20)
      .toArray();
    for (const row of rows) {
      const config = await smtpConfiguration(store, {
        ownerId: row.ownerId,
        workspaceId: row.workspaceId,
      });
      if (!config && !send) continue;
      const claimed = await store
        .collection('workspaceInvitations')
        .updateOne(
          { _id: row._id, delivery: 'queued', status: 'pending' },
          { $set: { delivery: 'sending', attemptedAt: new Date() } },
        );
      if (!claimed.modifiedCount) continue;
      try {
        const payload = JSON.parse(decryptSecret(row.message));
        const message = {
          from: config?.from,
          to: row.email,
          subject: 'Your AgentZuno workspace invitation',
          text: payload.text,
        };
        if (send) await send(message);
        else {
          const transport = await smtpTransport(config);
          try {
            await transport.sendMail(message);
          } finally {
            transport.close();
          }
        }
        await store
          .collection('workspaceInvitations')
          .updateOne(
            { _id: row._id },
            { $set: { delivery: 'sent', sentAt: new Date() }, $unset: { message: '' } },
          );
        await store.collection('governanceAudit').insertOne({
          ownerId: row.ownerId,
          workspaceId: row.workspaceId,
          actorType: 'worker',
          method: 'JOB',
          target: 'invitation.email',
          outcome: 'completed',
          completedAt: new Date(),
        });
      } catch {
        // Ambiguous SMTP delivery is not automatically resent, preventing duplicate invitations.
        await store
          .collection('workspaceInvitations')
          .updateOne(
            { _id: row._id },
            { $set: { delivery: 'failed', failedAt: new Date() }, $unset: { message: '' } },
          );
        await store.collection('governanceAudit').insertOne({
          ownerId: row.ownerId,
          workspaceId: row.workspaceId,
          actorType: 'worker',
          method: 'JOB',
          target: 'invitation.email',
          outcome: 'denied-or-failed',
          completedAt: new Date(),
        });
      }
    }
  };
}
export function installInvitationRoutes(app, store) {
  app.post('/api/helpdesk/invitations', async (request, response) => {
    const user = request.helpdeskUser;
    requireRole(user, ['admin']);
    const input = request.body || {};
    const value = validateMember(input);
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !value.active)
      deny('Provide an email address and an active membership.', 400);
    if (
      await store.collection('identitySettings').findOne({ ...helpdeskScope(user), enabled: true })
    )
      deny('Users are managed by the identity provider.', 409);
    if (!(await smtpConfiguration(store, helpdeskScope(user))))
      deny('Configure outgoing invitation email (SMTP) before inviting users.', 503);
    await requireExistingQueues(store, user, value.queues);
    const count = await store
      .collection('helpdeskMembers')
      .countDocuments({ workspaceId: user.workspaceId });
    if (count >= 200) deny('Workspace membership limit reached.', 422);
    const target = await store.collection('users').findOne({ email });
    if (
      target &&
      (await store
        .collection('helpdeskMembers')
        .findOne({ workspaceId: user.workspaceId, userId: target.id }))
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
        email,
        status: 'pending',
        expiresAt: { $gt: new Date() },
      })
    )
      deny('An invitation is already pending for this email address.', 409);
    const token = randomBytes(32).toString('hex');
    const origin = new URL(process.env.APP_ORIGIN || 'http://localhost:3000');
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password)
      deny('Configure the application origin.', 503);
    const text = `You have been invited to an AgentZuno workspace as ${value.role === 'read-only' ? 'Read Only' : value.role}. Sign in or register with ${email}, then accept this invitation:\n\n${origin.origin}/invite#${token}\n\nThis invitation expires in 7 days.`;
    const record = {
      ...helpdeskScope(user),
      email,
      ...value,
      invitedBy: user.id,
      tokenHash: hash(token),
      message: encryptSecret(JSON.stringify({ text })),
      status: 'pending',
      delivery: 'queued',
      createdAt: new Date(),
      nextAttemptAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 86400000),
    };
    const result = await store.collection('workspaceInvitations').insertOne(record);
    response
      .status(202)
      .json({ id: result.insertedId.toHexString(), email, status: 'pending', delivery: 'queued' });
  });
  app.get('/api/helpdesk/invitations', async (request, response) => {
    requireRole(request.helpdeskUser, ['admin']);
    const rows = await store
      .collection('workspaceInvitations')
      .find(
        { ...helpdeskScope(request.helpdeskUser) },
        { projection: { email: 1, role: 1, status: 1, delivery: 1, expiresAt: 1, createdAt: 1 } },
      )
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    response.json(
      listResponse(
        request,
        rows.map(({ _id, ...row }) => ({ id: _id.toHexString(), ...row })),
        {
          Email: 'email',
          Role: 'role',
          Status: 'status',
          Delivery: 'delivery',
          Expires: 'expiresAt',
        },
      ),
    );
  });
  app.post('/api/helpdesk/invitations/accept', async (request, response) => {
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
  });
}
