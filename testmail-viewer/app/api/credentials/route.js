import { cookies } from 'next/headers';

import {
  CREDS_COOKIE,
  CREDS_MAX_AGE,
  SESSION_COOKIE,
  cookieOptions,
  readSession,
  sealCredentials,
} from '../../../lib/session';

export const dynamic = 'force-dynamic';

function currentUser() {
  return readSession(cookies().get(SESSION_COOKIE)?.value);
}

export async function POST(request) {
  const username = await currentUser();
  if (!username) {
    return Response.json({ ok: false, message: 'Sign in first.' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const apikey = String(body.apikey || '').trim();
  const namespace = String(body.namespace || '').trim();

  if (!apikey || !namespace) {
    return Response.json(
      { ok: false, message: 'Both the API key and namespace are required.' },
      { status: 400 },
    );
  }

  // Check the pair works before storing it, so a typo fails here and not later.
  try {
    const params = new URLSearchParams({ apikey, namespace, limit: '1' });
    const probe = await fetch(`https://api.testmail.app/api/json?${params.toString()}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    const data = await probe.json().catch(() => null);

    if (!data || data.result !== 'success') {
      return Response.json(
        {
          ok: false,
          message:
            data?.message ||
            'testmail.app rejected that key and namespace. Check both in your console.',
        },
        { status: 400 },
      );
    }
  } catch {
    return Response.json(
      { ok: false, message: 'Could not reach testmail.app to check the key. Try again.' },
      { status: 502 },
    );
  }

  cookies().set(
    CREDS_COOKIE,
    sealCredentials(username, { apikey, namespace }),
    cookieOptions(CREDS_MAX_AGE),
  );

  return Response.json({ ok: true, namespace, keyHint: `…${apikey.slice(-4)}` });
}

export async function DELETE() {
  if (!(await currentUser())) {
    return Response.json({ ok: false, message: 'Sign in first.' }, { status: 401 });
  }
  cookies().delete(CREDS_COOKIE);
  return Response.json({ ok: true });
}
