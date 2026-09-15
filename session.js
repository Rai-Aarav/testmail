import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

import { readJson, storeConfigured, writeJsonIfAbsent } from './store';

export const SESSION_COOKIE = 'tmv_session';
export const CREDS_COOKIE = 'tmv_creds';
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days
export const CREDS_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

function secret() {
  const value = process.env.AUTH_SECRET;
  return value && value.length >= 16 ? value : null;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** AUTH_USERS looks like: alice:secret,bob:scrypt$salt$hash */
export function listEnvUsers() {
  return (process.env.AUTH_USERS || '')
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const split = entry.indexOf(':');
      if (split < 1) return null;
      return {
        username: entry.slice(0, split).trim().toLowerCase(),
        secret: entry.slice(split + 1).trim(),
      };
    })
    .filter(Boolean);
}

export function signupsOpen() {
  return storeConfigured() && process.env.SIGNUPS !== 'closed';
}

export function configIssues() {
  const issues = [];
  if (!secret()) issues.push('AUTH_SECRET is missing, or shorter than 16 characters.');
  if (listEnvUsers().length === 0 && !storeConfigured()) {
    issues.push(
      'Nobody can sign in: connect a Redis store to allow signups, or list accounts in AUTH_USERS.',
    );
  }
  return issues;
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}

function checkHash(stored, password) {
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  return safeEqual(scryptSync(password, salt, 64).toString('hex'), hash);
}

export function normaliseUsername(value) {
  return String(value || '').trim().toLowerCase();
}

export function validateSignup(username, password) {
  if (!USERNAME_PATTERN.test(username)) {
    return '3 to 32 characters, starting with a letter or number. Letters, numbers, dots, dashes and underscores only.';
  }
  if (password.length < MIN_PASSWORD) {
    return `Passwords need at least ${MIN_PASSWORD} characters.`;
  }
  if (password.length > MAX_PASSWORD) {
    return 'That password is too long.';
  }
  return null;
}

export async function accountExists(username) {
  if (listEnvUsers().some((user) => user.username === username)) return true;
  if (!storeConfigured()) return false;
  return Boolean(await readJson(`user:${username}`));
}

/** Claims the username, or returns false if someone already has it. */
export async function createAccount(username, password) {
  if (listEnvUsers().some((user) => user.username === username)) return false;
  return writeJsonIfAbsent(`user:${username}`, {
    username,
    hash: hashPassword(password),
    created: Date.now(),
  });
}

export async function verifyUser(username, password) {
  if (!password) return false;

  const envUser = listEnvUsers().find((user) => user.username === username);
  if (envUser) {
    return envUser.secret.startsWith('scrypt$')
      ? checkHash(envUser.secret, password)
      : safeEqual(envUser.secret, password);
  }

  if (!storeConfigured()) {
    // Spend comparable time either way so a missing account isn't faster to spot.
    scryptSync(password, 'absent-account', 64);
    return false;
  }

  const record = await readJson(`user:${username}`);
  if (!record?.hash) {
    scryptSync(password, 'absent-account', 64);
    return false;
  }

  return checkHash(record.hash, password);
}

export function createSession(username) {
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: Date.now() + SESSION_MAX_AGE * 1000 }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

/** Signature and expiry only — cheap, and used before any storage lookup. */
function decodeSession(token) {
  if (!token || !secret()) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data.u || null;
  } catch {
    return null;
  }
}

/** Decodes the cookie and confirms the account still exists. */
export async function readSession(token) {
  const username = decodeSession(token);
  if (!username) return null;
  try {
    return (await accountExists(username)) ? username : null;
  } catch {
    // If the store is briefly unreachable, a validly signed cookie still stands.
    return username;
  }
}

// Credentials are encrypted with a key derived per account, so one account's
// cookie is useless to another.
function credentialKey(username) {
  return scryptSync(secret(), `tmv-credentials:${username}`, 32);
}

export function sealCredentials(username, data) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', credentialKey(username), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

export function openCredentials(username, value) {
  if (!value || !secret()) return null;
  try {
    const raw = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      credentialKey(username),
      raw.subarray(0, 12),
    );
    decipher.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([
      decipher.update(raw.subarray(28)),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plain);
  } catch {
    return null;
  }
}

export function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}
