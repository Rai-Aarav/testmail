import { cookies } from 'next/headers';

import { clientIp, overLimit, recordAttempt } from '../../../../lib/ratelimit';
import {
  SESSION_MAX_AGE,
  SESSION_COOKIE,
  configIssues,
  cookieOptions,
  createAccount,
  createSession,
  normaliseUsername,
  signupsOpen,
  validateSignup,
} from '../../../../lib/session';

export const dynamic = 'force-dynamic';

const SIGNUPS_PER_IP = 5;
const SIGNUP_WINDOW = 60 * 60; // 1 hour

export async function POST(request) {
  const issues = configIssues();
  if (issues.length) {
    return Response.json({ ok: false, message: issues[0] }, { status: 500 });
  }

  if (!signupsOpen()) {
    return Response.json(
      { ok: false, message: 'Signups are closed on this deployment.' },
      { status: 403 },
    );
  }

  const throttleKey = `signup:${clientIp(request)}`;
  if (await overLimit(throttleKey, SIGNUPS_PER_IP)) {
    return Response.json(
      { ok: false, message: 'Too many accounts from this network. Try again later.' },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const username = normaliseUsername(body.username);
  const password = String(body.password || '');
  const code = String(body.code || '');

  const required = process.env.SIGNUP_CODE;
  if (required && code !== required) {
    await recordAttempt(throttleKey, SIGNUP_WINDOW);
    return Response.json({ ok: false, message: 'That invite code is wrong.' }, { status: 403 });
  }

  const problem = validateSignup(username, password);
  if (problem) {
    return Response.json({ ok: false, message: problem }, { status: 400 });
  }

  let claimed;
  try {
    claimed = await createAccount(username, password);
  } catch {
    return Response.json(
      { ok: false, message: 'Could not reach the account store. Try again.' },
      { status: 502 },
    );
  }

  if (!claimed) {
    return Response.json({ ok: false, message: 'That username is taken.' }, { status: 409 });
  }

  await recordAttempt(throttleKey, SIGNUP_WINDOW);
  cookies().set(SESSION_COOKIE, createSession(username), cookieOptions(SESSION_MAX_AGE));

  return Response.json({ ok: true, username });
}
