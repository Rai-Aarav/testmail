import { cookies } from 'next/headers';

import {
  CREDS_COOKIE,
  SESSION_COOKIE,
  configIssues,
  openCredentials,
  readSession,
  signupsOpen,
} from '../../../lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const issues = configIssues();
  const jar = cookies();
  const username = await readSession(jar.get(SESSION_COOKIE)?.value);

  const base = {
    issues,
    signupsOpen: signupsOpen(),
    inviteCodeRequired: Boolean(process.env.SIGNUP_CODE),
  };

  if (!username) {
    return Response.json({ ...base, username: null });
  }

  const credentials = openCredentials(username, jar.get(CREDS_COOKIE)?.value);

  return Response.json({
    ...base,
    username,
    namespace: credentials?.namespace || '',
    // Never send the key back — just enough to recognise which one is saved.
    keyHint: credentials?.apikey ? `…${credentials.apikey.slice(-4)}` : '',
  });
}
