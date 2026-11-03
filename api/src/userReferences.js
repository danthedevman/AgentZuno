import { helpdeskScope, requireRole } from './helpdeskRoles.js';
export async function userReferenceOptions(store, user) {
  requireRole(user, ['admin']);
  const members = await store
    .collection('helpdeskMembers')
    .find({ ...helpdeskScope(user), active: true })
    .toArray();
  const accounts = await store
    .collection('users')
    .find(
      { id: { $in: members.map((member) => member.userId) } },
      { projection: { id: 1, name: 1, email: 1, displayEmail: 1 } },
    )
    .toArray();
  return members
    .map((member) => {
      const account = accounts.find((item) => item.id === member.userId);
      const name = account?.name || member.email;
      const email = account?.displayEmail || member.email;
      return {
        value: member.userId,
        href: `/workspace/users/${member.userId}`,
        label: name === email ? email : `${name} (${email})`,
        name,
        email,
      };
    })
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }),
    );
}
