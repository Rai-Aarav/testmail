import { cookies } from 'next/headers';

import { SESSION_COOKIE } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

export async function POST() {
  cookies().delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
