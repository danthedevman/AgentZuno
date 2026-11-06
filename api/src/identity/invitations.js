import { createHash } from 'node:crypto';

import { smtpConfiguration, smtpTransport } from '../channels/smtpSettings.js';
import { decryptSecret } from '../shared/secrets.js';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
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
          { _id: row._id, delivery: 'queued', status: 'pending', tokenHash: row.tokenHash },
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
