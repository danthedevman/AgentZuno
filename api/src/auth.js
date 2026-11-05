import { isTimeZone } from './timezones.js';
import { isEmailAddress } from './emailAddress.js';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { promisify } from 'node:util';
import { readData } from './data.js';
import { createAccountStore } from './accountStore.js';

const deriveKey = promisify(scrypt);
const duration = 8 * 60 * 60 * 1000;

export function createAuth() {
  const accounts = createAccountStore();
  const sessions = new Map();
  const attempts = new Map();
  function token(request) {
    return request.headers.cookie
      ?.split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith('agentzuno_session='))
      ?.slice('agentzuno_session='.length);
  }
  async function currentUser(request) {
    const key = token(request);
    if (!key || !/^[a-f0-9]{64}$/.test(key)) return null;
    const session = await accounts.session(key);
    if (!session || Number(new Date(session.expiresAt)) <= Date.now()) {
      sessions.delete(key);
      return null;
    }
    if (session.user.isDemo || ['alex', 'jordan'].includes(session.user.id)) return null;
    const account = await accounts.findById(session.user.id);
    if (!account) return null;
    return Object.defineProperty(
      {
        ...session.user,
        impersonation: session.impersonation || null,
        name: account.name,
        profilePictureVersion: account.profilePictureVersion || 0,
        role: session.user.isDemo ? 'user' : 'admin',
      },
      'permissionSessionId',
      { value: session._id },
    );
  }
  async function setImpersonation(request, value) {
    if (!(await accounts.setImpersonation(token(request), value)))
      throw Object.assign(new Error('Sign in again to change impersonation.'), { status: 401 });
  }
  function rateLimit(request, response) {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.expiresAt < now) attempts.delete(key);
    const attempt = attempts.get(request.ip) || { count: 0, expiresAt: now + 60000 };
    attempts.set(request.ip, attempt);
    if (++attempt.count > 15) {
      response.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
      return true;
    }
    return false;
  }
  async function startSession(request, response, user, status = 200, redirectTo) {
    const old = token(request);
    sessions.delete(old);
    await accounts.deleteSession(old);
    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.displayEmail || user.email,
      workspaceId: user.workspaceId || `demo-${user.id}`,
      isDemo: !!user.isDemo,
      role: user.isDemo ? 'user' : 'admin',
    };
    const sessionToken = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + duration;
    await accounts.saveSession(sessionToken, safeUser, expiresAt);
    sessions.set(sessionToken, { user: safeUser, expiresAt });
    for (const [key, session] of sessions)
      if (Number(new Date(session.expiresAt)) <= Date.now()) sessions.delete(key);
    response.cookie('agentzuno_session', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: duration,
      path: '/',
    });
    request.user = safeUser;
    if (redirectTo) return response.redirect(303, redirectTo);
    response.status(status).json({ user: safeUser });
  }
  async function login(request, response) {
    if (rateLimit(request, response)) return;
    const { email, password } = request.body || {};
    if (
      typeof email !== 'string' ||
      typeof password !== 'string' ||
      password.length > 200 ||
      email.length > 254
    )
      return response.status(400).json({ error: 'Enter your email and password.' });
    const normalized = email.trim().toLowerCase();
    if (normalized.endsWith('@identity.agentzuno.invalid'))
      return response.status(400).json({ error: 'Use a valid account email.' });
    const demos = await readData('private/users.json');
    const demo = demos.find((user) => user.email === normalized);
    const foundUser = demo ? null : await accounts.findUser(normalized);
    const user = foundUser?.identityOnly ? null : foundUser;
    const key = await deriveKey(password, user?.salt || 'agentzuno-unknown', 64);
    if (!user || !timingSafeEqual(key, Buffer.from(user.passwordHash, 'hex')))
      return response.status(401).json({ error: 'Email or password is incorrect.' });
    await startSession(request, response, user);
  }
  async function register(request, response) {
    if (
      request.body &&
      Object.keys(request.body).some(
        (key) => !['name', 'email', 'password', 'timezone'].includes(key),
      )
    )
      return response.status(400).json({
        error: 'Only name, email, password and timezone can be supplied during registration.',
      });
    if (rateLimit(request, response)) return;
    const { email, password, name, timezone = 'UTC' } = request.body || {};
    if (!isTimeZone(timezone))
      return response.status(400).json({ error: 'Choose a valid timezone.' });
    if (
      name !== undefined &&
      (typeof name !== 'string' ||
        !name.trim() ||
        name.length > 160 ||
        /[\x00-\x1f\x7f]/u.test(name))
    )
      return response.status(400).json({ error: 'Enter a name between 1 and 160 characters.' });
    if (
      typeof email !== 'string' ||
      email.length > 254 ||
      !isEmailAddress(email.trim()) ||
      typeof password !== 'string' ||
      password.length < 12 ||
      password.length > 200
    )
      return response
        .status(400)
        .json({ error: 'Enter a valid email and a password between 12 and 200 characters.' });
    const normalized = email.trim().toLowerCase();
    if (normalized.endsWith('@identity.agentzuno.invalid'))
      return response.status(400).json({ error: 'Use a valid account email.' });
    const demos = await readData('private/users.json');
    if (demos.some((user) => user.email === normalized))
      return response.status(409).json({ error: 'An account already exists. Sign in instead.' });
    const salt = randomBytes(16).toString('hex');
    const passwordHash = (await deriveKey(password, salt, 64)).toString('hex');
    const user = {
      id: new ObjectId().toHexString(),
      workspaceId: new ObjectId().toHexString(),
      email: normalized,
      name: name === undefined ? normalized.split('@')[0] : name.trim(),
      timezone,
      salt,
      passwordHash,
      createdAt: new Date(),
    };
    try {
      await accounts.createUser(user);
    } catch (error) {
      if (error.code === 11000)
        return response.status(409).json({ error: 'An account already exists. Sign in instead.' });
      throw error;
    }
    await startSession(request, response, user, 201);
  }
  async function logout(request, response) {
    const key = token(request);
    sessions.delete(key);
    await accounts.deleteSession(key);
    response.clearCookie('agentzuno_session', { path: '/' });
    response.json({ user: null });
  }
  return {
    currentUser,
    setImpersonation,
    login,
    register,
    logout,
    startSession,
    accounts,
    close: accounts.close,
  };
}
