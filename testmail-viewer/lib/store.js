// Talks to Upstash Redis over its REST API. Vercel's Marketplace Redis
// integration injects KV_REST_API_URL / KV_REST_API_TOKEN; connecting Upstash
// directly gives the UPSTASH_ names. Either pair works, and no client library
// is needed — the REST API takes a command as a JSON array.

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

export function storeConfigured() {
  return Boolean(url && token);
}

async function send(path, body) {
  const response = await fetch(`${url}${path}`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(`Redis returned ${response.status}`);
  }
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}

async function command(args) {
  const data = await send('', args);
  return data.result;
}

export async function readJson(key) {
  const raw = await command(['GET', key]);
  if (raw === null || raw === undefined) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

/** Returns false if the key already exists, which is how signup claims a username. */
export async function writeJsonIfAbsent(key, value) {
  const result = await command(['SET', key, JSON.stringify(value), 'NX']);
  return result === 'OK';
}

export async function writeJson(key, value) {
  await command(['SET', key, JSON.stringify(value)]);
}

export async function remove(key) {
  await command(['DEL', key]);
}

/** Increments a counter and keeps a rolling expiry on it. Returns the new count. */
export async function bump(key, ttlSeconds) {
  const data = await send('/pipeline', [
    ['INCR', key],
    ['EXPIRE', key, String(ttlSeconds)],
  ]);
  const first = Array.isArray(data) ? data[0] : null;
  if (first?.error) throw new Error(first.error);
  return Number(first?.result ?? 0);
}

export async function counter(key) {
  const value = await command(['GET', key]);
  return Number(value || 0);
}
