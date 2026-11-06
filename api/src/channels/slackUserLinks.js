import { createHash, randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { queryString, queryStrings, queryVersion } from '../shared/queryValues.js';
import { decryptSecret, encryptSecret } from '../shared/secrets.js';
import { requireRole, resolveHelpdeskUser, deny } from '../identity/helpdeskRoles.js';
import { requireCurrentChannelApplication } from './channelApplications.js';
import { requireConnectorAction } from '../integrations/connectorActions.js';
import { fetchChannelJson } from './helpdeskChannels.js';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const slackId = (id) =>
  typeof id === 'string' && id !== 'USLACKBOT' && /^[UW][A-Z0-9]{2,39}$/.test(id);
const scope = (user) => ({
  ownerId: queryString(user.helpdeskOwnerId || user.id, 80),
  workspaceId: queryString(user.workspaceId, 24),
});
const nonce = (token) => {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
    deny('Invalid linking request.', 400);
  return hash(token);
};

export function createSlackUserLinks(store, configure, fetcher = fetch) {
  async function sourceFor(user, admin = true) {
    const account = await store
      .collection('users')
      .findOne({ id: queryString(user.id), active: { $ne: false } }, { projection: { id: 1 } });
    if (!account) deny('Your account is no longer active.', 403);
    const actor = await resolveHelpdeskUser(
      store,
      { id: queryString(user.id, 80) },
      queryString(user.workspaceId, 24),
    );
    if (admin) {
      requireRole(user, ['admin']);
      if (actor.role !== 'admin' || user.role !== 'admin')
        deny('Administrator access is required.', 403);
    }
    const source = await store
      .collection('helpdeskChannels')
      .findOne({ ...scope(actor), provider: 'slack' });
    if (!source?.credential || (source.expiresAt && new Date(source.expiresAt) <= new Date()))
      deny('Connect Slack before linking users.', 409);
    await requireCurrentChannelApplication(store, source);
    return source;
  }
  async function members(source) {
    const memberships = await store
      .collection('helpdeskMembers')
      .find({
        ownerId: queryString(source.ownerId),
        workspaceId: queryString(source.workspaceId),
        active: true,
      })
      .limit(10000)
      .toArray();
    const ids = [...new Set([source.ownerId, ...memberships.map((item) => item.userId)])];
    return store
      .collection('users')
      .find(
        { id: { $in: queryStrings(ids, 10001, 80) }, active: { $ne: false } },
        { projection: { id: 1, name: 1, email: 1 } },
      )
      .limit(10001)
      .toArray();
  }
  async function discover(user) {
    const source = await sourceFor(user);
    if (
      !['users:read', 'users:read.email'].every((value) =>
        source.slackGrantedScopes?.includes(value),
      )
    )
      deny('Reauthorize Slack to allow member discovery and email matching.', 409);
    const accounts = await members(source),
      directory = new Map(),
      byEmail = new Map();
    for (const account of accounts) {
      const email = account.email?.toLowerCase();
      if (email) byEmail.set(email, [...(byEmail.get(email) || []), account]);
    }
    const deadline = Date.now() + 30000;
    const credentials = JSON.parse(decryptSecret(source.credential));
    let cursor = '',
      finished = false;
    const seen = new Set();
    for (let page = 0; page < 50; page++) {
      if (Date.now() > deadline)
        deny('Slack discovery timed out. No changes were made; retry later.', 502);
      const url = new URL('https://slack.com/api/users.list');
      url.searchParams.set('limit', '200');
      if (cursor) url.searchParams.set('cursor', cursor);
      const result = await fetchChannelJson(fetcher, url.href, {
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
      });
      if (result?.ok !== true || !Array.isArray(result.members) || result.members.length > 200)
        deny('Slack member discovery failed. Check permissions and retry.', 422);
      for (const person of result.members) {
        if (
          !slackId(person?.id) ||
          person.deleted ||
          person.is_bot ||
          person.is_app_user ||
          person.is_restricted ||
          person.is_ultra_restricted ||
          person.is_invited_user ||
          person.id === source.slackBotUserId ||
          (person.team_id && person.team_id !== source.slackTeamId)
        )
          continue;
        const email =
          typeof person.profile?.email === 'string'
            ? person.profile.email.trim().toLowerCase()
            : '';
        if (email.length > 254) continue;
        const matches = byEmail.get(email) || [];
        const existing = source.bot.identityBindings?.find(
          (item) => item.slackUserId === person.id,
        );
        directory.set(person.id, {
          slackUserId: person.id,
          name: String(person.real_name || person.name || person.id).slice(0, 120),
          email,
          userId: existing?.userId || (matches.length === 1 ? matches[0].id : ''),
          status: existing
            ? 'Linked'
            : matches.length === 1
              ? 'Review email match'
              : matches.length > 1
                ? 'Ambiguous email'
                : 'Unmatched',
        });
      }
      cursor = result.response_metadata?.next_cursor || '';
      if (typeof cursor !== 'string' || cursor.length > 2000 || seen.has(cursor))
        deny('Slack returned invalid pagination.', 422);
      if (!cursor) {
        finished = true;
        break;
      }
      seen.add(cursor);
    }
    if (!finished) deny('Slack directory exceeds the discovery limit. No changes were made.', 422);
    const current = await sourceFor(user);
    if (
      current.slackGeneration !== source.slackGeneration ||
      current.bot.version !== source.bot.version
    )
      deny('Slack settings changed. Find users again.', 409);
    const emailCounts = new Map();
    for (const row of directory.values())
      if (row.email) emailCounts.set(row.email, (emailCounts.get(row.email) || 0) + 1);
    for (const row of directory.values())
      if (row.status !== 'Linked' && row.email && emailCounts.get(row.email) > 1) {
        row.status = 'Ambiguous email';
        row.userId = '';
      }
    const id = new ObjectId().toHexString(),
      rows = [...directory.values()].sort((a, b) => a.name.localeCompare(b.name));
    await store.collection('slackLinkReviews').insertOne({
      _id: id,
      ...scope(user),
      actorId: user.id,
      generation: source.slackGeneration,
      version: source.bot.version,
      state: 'pending',
      directory: encryptSecret(JSON.stringify(rows)),
      rows: rows.map(({ slackUserId }) => ({ slackUserId })),
      expiresAt: new Date(Date.now() + 900000),
    });
    return { id, version: source.bot.version, rows: rows.slice(0, 20), total: rows.length };
  }
  async function page(user, id, query = {}) {
    const source = await sourceFor(user);
    if (
      !/^[a-f0-9]{24}$/.test(id || '') ||
      Object.keys(query).some((key) => !['page', 'search', 'selection'].includes(key)) ||
      (query.page !== undefined &&
        (typeof query.page !== 'string' || !/^[1-9][0-9]{0,4}$/.test(query.page))) ||
      (query.search !== undefined &&
        (typeof query.search !== 'string' || query.search.length > 120))
    )
      deny('Invalid review page.', 400);
    const review = await store.collection('slackLinkReviews').findOne({
      _id: queryString(id, 24),
      ...scope(user),
      actorId: queryString(user.id),
      generation: queryString(source.slackGeneration),
      version: queryVersion(source.bot.version),
      state: 'pending',
      expiresAt: { $gt: new Date() },
    });
    if (!review) deny('This review expired or Slack settings changed. Find users again.', 409);
    const search = (query.search || '').trim().toLowerCase(),
      number = Number(query.page || '1');
    if (query.selection !== undefined && query.selection !== 'suggested')
      deny('Invalid selection.', 400);
    const rows = JSON.parse(decryptSecret(review.directory)).filter(
      (row) =>
        !search || `${row.name} ${row.email} ${row.slackUserId}`.toLowerCase().includes(search),
    );
    if (query.selection === 'suggested') {
      const existing = source.bot.identityBindings || [];
      const bindings = rows
        .filter(
          (row) =>
            row.status === 'Review email match' &&
            row.userId &&
            !existing.some((item) => item.userId === row.userId),
        )
        .map(({ slackUserId, userId }) => ({ slackUserId, userId }));
      if (existing.length + bindings.length > 1000)
        deny(
          'This selection exceeds the 1,000-link limit. Filter the review or select a smaller batch.',
          400,
        );
      return { bindings };
    }
    return {
      id,
      version: source.bot.version,
      rows: rows.slice((number - 1) * 20, number * 20),
      total: rows.length,
      page: number,
    };
  }
  async function apply(user, input) {
    if (
      !input ||
      Object.keys(input).some((key) => !['id', 'version', 'confirmed', 'bindings'].includes(key)) ||
      input.confirmed !== true ||
      !/^[a-f0-9]{24}$/.test(input.id || '') ||
      !Array.isArray(input.bindings) ||
      !input.bindings.length ||
      input.bindings.length > 1000
    )
      deny('Review and confirm up to 1,000 user links.', 400);
    const source = await sourceFor(user);
    const filter = {
      _id: queryString(input.id, 24),
      ...scope(user),
      actorId: queryString(user.id),
      generation: queryString(source.slackGeneration),
      version: queryVersion(input.version),
      state: 'pending',
      expiresAt: { $gt: new Date() },
    };
    const review = await store.collection('slackLinkReviews').findOne(filter);
    if (!review || source.bot.version !== input.version)
      deny('This review expired or Slack settings changed. Find users again.', 409);
    const existing = source.bot.identityBindings || [],
      additions = [];
    for (const item of input.bindings) {
      if (
        !item ||
        Object.keys(item).some((key) => !['slackUserId', 'userId'].includes(key)) ||
        !slackId(item.slackUserId) ||
        typeof item.userId !== 'string' ||
        !review.rows.some((row) => row.slackUserId === item.slackUserId)
      )
        deny('Choose users from this review.', 400);
      if (
        existing.some((row) => row.slackUserId === item.slackUserId || row.userId === item.userId)
      )
        deny(
          'A selected account is already linked. Remove its existing link explicitly before replacing it.',
          409,
        );
      additions.push({ slackUserId: item.slackUserId, userId: item.userId });
    }
    if (
      new Set(additions.map((item) => item.slackUserId)).size !== additions.length ||
      new Set(additions.map((item) => item.userId)).size !== additions.length ||
      existing.length + additions.length > 1000
    )
      deny('Choose unique accounts within the 1,000-link limit.', 400);
    const claim = await store
      .collection('slackLinkReviews')
      .updateOne(filter, { $set: { state: 'consumed' } });
    if (!claim.matchedCount) deny('This review was already used.', 409);
    await configure(user, {
      enabled: source.bot.enabled,
      version: input.version,
      identityBindings: [...existing, ...additions],
    });
    return { linked: additions.length };
  }
  async function issue(source, slackUserId) {
    if (!slackId(slackUserId)) deny('Invalid Slack user.', 400);
    await requireCurrentChannelApplication(store, source);
    const token = randomBytes(32).toString('hex');
    await store.collection('slackSelfLinks').insertOne({
      _id: hash(token),
      ownerId: queryString(source.ownerId),
      workspaceId: queryString(source.workspaceId),
      sourceId: String(source._id),
      generation: queryString(source.slackGeneration),
      slackUserId,
      expiresAt: new Date(Date.now() + 600000),
      used: false,
    });
    return `${process.env.APP_ORIGIN || 'http://localhost:3000'}/slack/link#${token}`;
  }
  async function resolve(user, token) {
    const row = await store
      .collection('slackSelfLinks')
      .findOne({ _id: nonce(token), used: false, expiresAt: { $gt: new Date() } });
    if (!row) deny('This linking request expired or was already used. Message Zuno again.', 409);
    const actor = await resolveHelpdeskUser(store, { id: queryString(user.id) }, row.workspaceId);
    if (actor.helpdeskOwnerId !== row.ownerId || actor.role === 'read-only' || user.impersonation)
      deny('Sign in with your own active account in this workspace.', 403);
    const source = await sourceFor(actor, false);
    if (
      String(source._id) !== row.sourceId ||
      source.slackGeneration !== row.generation ||
      !source.bot.enabled
    )
      deny('Slack connection changed. Message Zuno again.', 409);
    await requireConnectorAction(store, source, 'receiveMessages');
    await requireConnectorAction(store, source, 'respondToUsers');
    return { row, actor, source };
  }
  async function inspect(user, input) {
    if (!input || Object.keys(input).some((key) => key !== 'token'))
      deny('Invalid linking request.', 400);
    const { row, source } = await resolve(user, input.token);
    return {
      slackUserId: row.slackUserId,
      teamName: source.slackTeamName,
      workspaceId: row.workspaceId,
    };
  }
  async function complete(user, input) {
    if (
      !input ||
      Object.keys(input).some((key) => !['token', 'confirmed'].includes(key)) ||
      input.confirmed !== true
    )
      deny('Confirm linking your own account.', 400);
    const { row, actor, source } = await resolve(user, input.token);
    if ((source.bot.identityBindings || []).length >= 1000)
      deny('Ask an Admin to review the Slack link limit.', 409);
    if (
      (source.bot.identityBindings || []).some(
        (item) => item.slackUserId === row.slackUserId || item.userId === actor.id,
      )
    )
      deny('An account is already linked. Ask an Admin to review the existing mapping.', 409);
    const claim = await store
      .collection('slackSelfLinks')
      .updateOne(
        { _id: nonce(input.token), used: false, expiresAt: { $gt: new Date() } },
        { $set: { used: true } },
      );
    if (!claim.matchedCount) deny('This linking request was already used.', 409);
    const updated = await store.collection('helpdeskChannels').updateOne(
      {
        ...scope(actor),
        provider: 'slack',
        slackGeneration: queryString(row.generation),
        'bot.version': queryVersion(source.bot.version),
      },
      {
        $push: { 'bot.identityBindings': { slackUserId: row.slackUserId, userId: actor.id } },
        $inc: { 'bot.version': 1 },
        $set: { 'bot.updatedAt': new Date() },
      },
    );
    if (!updated.matchedCount) deny('Slack settings changed. Message Zuno again.', 409);
    return { linked: true, workspaceId: row.workspaceId };
  }
  return { discover, page, apply, issue, inspect, complete };
}
