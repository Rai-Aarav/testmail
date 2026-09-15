import { cookies } from 'next/headers';

import {
  CREDS_COOKIE,
  SESSION_COOKIE,
  openCredentials,
  readSession,
} from '../../../lib/session';

const ENDPOINT = 'https://api.testmail.app/api/json';

// Params forwarded straight through to testmail.app.
// Reference: https://testmail.app/docs/#json-api-reference
const FORWARDED = [
  'tag',
  'tag_prefix',
  'timestamp_from',
  'timestamp_to',
  'limit',
  'offset',
  'headers',
  'spam_report',
  'livequery',
];

export const dynamic = 'force-dynamic';

function fail(message, status) {
  return Response.json({ result: 'fail', message, count: 0, emails: [] }, { status });
}

export async function GET(request) {
  const jar = cookies();
  const username = await readSession(jar.get(SESSION_COOKIE)?.value);

  if (!username) {
    return fail('Your session expired. Sign in again.', 401);
  }

  const credentials = openCredentials(username, jar.get(CREDS_COOKIE)?.value);
  if (!credentials?.apikey) {
    return fail('No API key saved for this account.', 428);
  }

  const incoming = new URL(request.url).searchParams;
  const namespace = incoming.get('namespace') || credentials.namespace;

  if (!namespace) {
    return fail('No namespace to query.', 400);
  }

  const params = new URLSearchParams({ apikey: credentials.apikey, namespace });
  for (const key of FORWARDED) {
    const value = incoming.get(key);
    if (value !== null && value !== '') params.set(key, value);
  }

  try {
    const upstream = await fetch(`${ENDPOINT}?${params.toString()}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });

    // livequery redirects to itself when it gives up waiting for mail
    if (upstream.status === 307) {
      return Response.json(
        {
          result: 'success',
          message: 'No new mail yet.',
          count: 0,
          limit: 0,
          offset: 0,
          emails: [],
        },
        { status: 200 },
      );
    }

    const body = await upstream.text();
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return fail(`testmail.app returned ${upstream.status}.`, 502);
    }

    return Response.json(data, { status: upstream.ok ? 200 : upstream.status });
  } catch (error) {
    return fail(error?.message || 'Could not reach testmail.app.', 502);
  }
}
