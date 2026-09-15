import { bump, counter, remove, storeConfigured } from './store';

// Best effort. With no store connected there's nowhere to count, so these
// become no-ops rather than blocking anyone.

export async function overLimit(key, max) {
  if (!storeConfigured()) return false;
  try {
    return (await counter(key)) >= max;
  } catch {
    return false;
  }
}

export async function recordAttempt(key, ttlSeconds) {
  if (!storeConfigured()) return;
  try {
    await bump(key, ttlSeconds);
  } catch {
    // Counting is not worth failing a request over.
  }
}

export async function clearAttempts(key) {
  if (!storeConfigured()) return;
  try {
    await remove(key);
  } catch {
    // Nothing to do; the counter expires on its own.
  }
}

export function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0].trim() || 'unknown';
}
