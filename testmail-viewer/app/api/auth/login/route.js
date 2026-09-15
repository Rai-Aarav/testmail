import { cookies } from 'next/headers';

import { clearAttempts, overLimit, recordAttempt } from '../../../../lib/ratelimit';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  configIssues,
  cookieOptions,
  createSession,
  normaliseUsername,
  verifyUser,
} from '../../../../lib/session';

export const dynamic = 'force-dynamic';

const MAX_FAILURES = 10;
const FAILURE_WINDOW = 15 * 60; // 15 minutes

export async function POST(request) {
  const issues = configIssues();
  if (issues.length) {
    return Response.json({ ok: false, message: issues[0] }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const username = normaliseUsername(body.username);
  const password = String(body.password || '');

  if (!username || !password) {
    return Response.json({ ok: false, message: 'Enter a username and password.' }, { status: 400 });
  }

  const failureKey = `fail:${username}`;
  if (await overLimit(failureKey, MAX_FAILURES)) {
    return Response.json(
      { ok: false, message: 'Too many failed attempts. Wait 15 minutes and try again.' },
      { status: 429 },
    );
  }

  let ok = false;
  try {
    ok = await verifyUser(username, password);
  } catch {
    return Response.json(
      { ok: false, message: 'Could not reach the account store. Try again.' },
      { status: 502 },
    );
  }

  if (!ok) {
    await recordAttempt(failureKey, FAILURE_WINDOW);
    return Response.json({ ok: false, message: 'Wrong username or password.' }, { status: 401 });
  }

  await clearAttempts(failureKey);
  cookies().set(SESSION_COOKIE, createSession(username), cookieOptions(SESSION_MAX_AGE));
  return Response.json({ ok: true, username });
}
