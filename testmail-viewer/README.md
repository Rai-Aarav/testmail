# testmail viewer

A shared web inbox for [testmail.app](https://testmail.app). Anyone can create an account, add
their own API key, and read the mail sent to `{namespace}.{tag}@inbox.testmail.app`.

Every account brings its own testmail credentials, so people using the same deployment never see
each other's mail.

## How accounts and keys work

**Accounts** are created on the site and stored in Redis as a username and an scrypt hash. Signing
in sets an HMAC-signed session cookie that lasts 7 days.

**testmail credentials** are not environment variables. Each user pastes their own API key and
namespace into the app after signing in. The pair is checked against testmail.app, then encrypted
with AES-256-GCM and stored in an httpOnly cookie for 30 days. It is never written to Redis, never
sent back to the browser, and the encryption key is derived per account — so one user's cookie is
undecryptable by another, and a Redis leak exposes no API keys.

The tradeoff: credentials live in the browser that set them, so signing in on a laptop and a phone
means entering the key twice, and clearing cookies loses it. Moving them into Redis would fix that
but would put everyone's live API keys in one database, which is a worse place to be.

## What it does

- Edit the namespace and tag inline in the address bar; the query re-runs as you type
- Match a tag exactly, or everything starting with it (`tag_prefix`)
- Filter by arrival time, page through results, search what's loaded
- Auto-refresh every 5, 15 or 60 seconds
- Read HTML (sandboxed iframe), plain text, headers, and the raw JSON
- One-click copy for OTP codes found in the body
- Spam score, attachments, and a download link for the original message
- Dark mode, `j` / `k` to walk the list

## Set up

### 1. Connect a Redis store

In your Vercel project, **Storage → Create Database**, pick a Redis integration from the
Marketplace (Upstash's free tier is plenty — accounts are a few hundred bytes each), and connect
it to the project. That injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Upstash's own names,
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, work too.

No client library is involved; `lib/store.js` talks to the REST API with `fetch`.

Without a store the site still runs, but signups are off and only `AUTH_USERS` accounts can sign
in.

### 2. Set the secret

```bash
npm run secret
```

Put the output in `AUTH_SECRET`. Changing it later signs everyone out and makes every stored API
key unreadable, so people re-enter theirs.

### 3. Optional variables

| Name | Does |
|---|---|
| `SIGNUP_CODE` | Asks for this code before creating an account |
| `SIGNUPS=closed` | Turns signups off while keeping existing accounts working |
| `AUTH_USERS` | Accounts that work without Redis: `aarav:scrypt$4f1c…,sam:plaintext` |

`AUTH_USERS` entries take precedence over stored accounts and can't be signed up over. Hash the
passwords with `npm run hash -- their-password`; plaintext works but environment variables are
visible to anyone with access to the Vercel project. Usernames and plaintext passwords can't
contain `:` or `,`.

## Signup rules

- Usernames are lowercased: 3–32 characters, starting with a letter or number, then letters,
  numbers, dots, dashes, underscores
- Passwords need at least 8 characters
- 5 accounts per IP per hour
- 10 failed sign-ins per username locks that account for 15 minutes; a successful sign-in clears
  the count. The lock is per username, so someone who knows a username can deliberately lock it
  for 15 minutes — if that matters to you, key the counter on IP as well in `lib/ratelimit.js`

## Run it locally

```bash
npm install
cp .env.example .env.local   # AUTH_SECRET, and Redis if you want signups
npm run dev
```

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel, **Add New → Project**, import the repo. Next.js is detected; leave the build
   settings alone.
3. Connect a Redis store and set `AUTH_SECRET`.
4. Deploy.

Changing an environment variable needs a redeploy to take effect. If `AUTH_SECRET` is missing, or
there's neither a store nor `AUTH_USERS`, the site opens on a setup screen instead of a login
form.

## Routes

| Route | Does |
|---|---|
| `POST /api/auth/signup` | Creates an account and signs it in |
| `POST /api/auth/login` | Checks the password, sets the session cookie |
| `POST /api/auth/logout` | Clears the session, leaves the encrypted key cookie |
| `GET /api/session` | Current username, namespace, last 4 of the saved key, signup status |
| `POST /api/credentials` | Validates a key against testmail, then encrypts and stores it |
| `DELETE /api/credentials` | Forgets the key on this browser |
| `GET /api/inbox` | Proxies the query to testmail.app using the stored key |

`/api/inbox` forwards `tag`, `tag_prefix`, `timestamp_from`, `timestamp_to`, `limit`, `offset`,
`headers`, `spam_report` and `livequery` to `https://api.testmail.app/api/json` and returns the
response untouched. It answers 401 when the session has expired and 428 when the account has no
key saved.

`limit` maxes out at 100 and `offset` at 9899. Free testmail plans allow 1,000 requests an hour
per key, so a 5-second auto-refresh burns through that in about 90 minutes — leave it on Manual
unless you're waiting on something. The budget is per key, so each user has their own.

`livequery=true` is forwarded but unused by the UI. It holds the connection open until mail
arrives, which suits a test runner rather than a browser: testmail.app returns a 307 redirect
every 60 seconds and a serverless function hits its time limit first. Polling is what works here.

Full API reference: https://testmail.app/docs/
