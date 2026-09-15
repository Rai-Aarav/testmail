'use client';

import { useCallback, useEffect, useState } from 'react';

import Viewer from './viewer';

function SetupHelp({ issues }) {
  return (
    <div className="gate">
      <div className="panel">
        <h1>Finish the setup</h1>
        <p className="hint">
          The app can&apos;t sign anyone in until these are set in your Vercel project, under
          Settings → Environment Variables. Redeploy after adding them.
        </p>
        <ul className="issues">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
        <p className="hint">
          Generate a secret with <code>npm run secret</code>. For open signups, connect a Redis
          store from the Vercel Marketplace; without one, list accounts in <code>AUTH_USERS</code>{' '}
          and hash each password with <code>npm run hash -- their-password</code>.
        </p>
      </div>
    </div>
  );
}

function Auth({ session, onDone }) {
  const [mode, setMode] = useState('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const joining = mode === 'signup';

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch(joining ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password, code }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message || 'That did not work.');
        return;
      }
      onDone();
    } catch {
      setError('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function switchTo(next) {
    setMode(next);
    setError('');
  }

  return (
    <div className="gate">
      <form className="panel" onSubmit={submit}>
        <h1>{joining ? 'Create an account' : 'Sign in'}</h1>
        <p className="hint">
          {joining
            ? 'Pick a username and password, then add your own testmail.app key. Your inbox stays yours.'
            : 'Then add your own testmail.app key to read your inboxes.'}
        </p>

        <label className="label" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          className="input"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          autoFocus
          spellCheck={false}
        />

        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className="input"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={joining ? 'new-password' : 'current-password'}
        />
        {joining ? <p className="assist">At least 8 characters.</p> : null}

        {joining && session.inviteCodeRequired ? (
          <>
            <label className="label" htmlFor="code">
              Invite code
            </label>
            <input
              id="code"
              className="input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              spellCheck={false}
            />
          </>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}

        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy
            ? joining
              ? 'Creating…'
              : 'Signing in…'
            : joining
              ? 'Create account'
              : 'Sign in'}
        </button>

        {session.signupsOpen ? (
          <p className="switch">
            {joining ? 'Already have an account?' : 'No account yet?'}{' '}
            <button
              type="button"
              className="linkish"
              onClick={() => switchTo(joining ? 'signin' : 'signup')}
            >
              {joining ? 'Sign in' : 'Create one'}
            </button>
          </p>
        ) : null}
      </form>
    </div>
  );
}

function Credentials({ session, onSaved, onCancel, onCleared }) {
  const [apikey, setApikey] = useState('');
  const [namespace, setNamespace] = useState(session.namespace || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apikey, namespace }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message || 'Could not save.');
        return;
      }
      onSaved({ namespace: data.namespace, keyHint: data.keyHint });
    } catch {
      setError('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function forget() {
    await fetch('/api/credentials', { method: 'DELETE' });
    onCleared();
  }

  return (
    <div className="gate">
      <form className="panel" onSubmit={submit}>
        <h1>{session.keyHint ? 'Change your testmail key' : 'Add your testmail key'}</h1>
        <p className="hint">
          Both come from your{' '}
          <a href="https://testmail.app/console" target="_blank" rel="noreferrer">
            testmail.app console
          </a>
          . They&apos;re encrypted and kept in a cookie for this browser only — never stored on
          the server, never sent to anyone else.
        </p>

        <label className="label" htmlFor="apikey">
          API key
        </label>
        <input
          id="apikey"
          className="input mono"
          value={apikey}
          onChange={(event) => setApikey(event.target.value)}
          placeholder={session.keyHint ? `Currently ${session.keyHint}` : 'ac6e1234-…'}
          autoFocus
          spellCheck={false}
        />

        <label className="label" htmlFor="namespace">
          Namespace
        </label>
        <input
          id="namespace"
          className="input mono"
          value={namespace}
          onChange={(event) => setNamespace(event.target.value.trim())}
          placeholder="xyz12"
          spellCheck={false}
        />

        {error ? <p className="form-error">{error}</p> : null}

        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Checking with testmail…' : 'Save and open inbox'}
        </button>

        <div className="panel-foot">
          {onCancel ? (
            <button type="button" className="btn btn-quiet" onClick={onCancel}>
              Cancel
            </button>
          ) : (
            <span />
          )}
          {session.keyHint ? (
            <button type="button" className="btn btn-quiet" onClick={forget}>
              Forget key on this browser
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

export default function AppShell() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/session', { cache: 'no-store' });
      setSession(await res.json());
    } catch {
      setSession({ username: null, issues: ['Could not reach the server.'] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setEditing(false);
    setSession({ ...session, username: null, keyHint: '', namespace: '' });
  }

  if (loading) {
    return (
      <div className="gate">
        <p className="hint">Loading…</p>
      </div>
    );
  }

  if (!session?.username) {
    if (session?.issues?.length) return <SetupHelp issues={session.issues} />;
    return <Auth session={session} onDone={refresh} />;
  }

  const needsKey = !session.keyHint;

  return (
    <>
      <header className="topbar">
        <span className="brand">testmail inbox</span>
        <span className="spacer" />
        {session.keyHint ? <span className="who mono">key {session.keyHint}</span> : null}
        <span className="who">{session.username}</span>
        <button className="btn btn-quiet" onClick={() => setEditing(true)}>
          API key
        </button>
        <button className="btn btn-quiet" onClick={signOut}>
          Sign out
        </button>
      </header>

      {needsKey || editing ? (
        <Credentials
          session={session}
          onSaved={(next) => {
            setSession({ ...session, ...next });
            setEditing(false);
          }}
          onCleared={() => {
            setSession({ ...session, keyHint: '', namespace: '' });
            setEditing(false);
          }}
          onCancel={needsKey ? null : () => setEditing(false)}
        />
      ) : (
        <Viewer
          key={session.keyHint}
          defaultNamespace={session.namespace}
          onUnauthorized={refresh}
          onMissingKey={() => setEditing(true)}
        />
      )}
    </>
  );
}
