'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DOMAIN = '@inbox.testmail.app';
const SINCE = [
  { label: 'Any time', ms: 0 },
  { label: 'Last hour', ms: 60 * 60 * 1000 },
  { label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
  { label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
];
const REFRESH = [
  { label: 'Manual', ms: 0 },
  { label: 'Every 5s', ms: 5000 },
  { label: 'Every 15s', ms: 15000 },
  { label: 'Every 60s', ms: 60000 },
];

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function fullTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
}

function senderName(email) {
  return (
    email?.from_parsed?.[0]?.name ||
    email?.from_parsed?.name ||
    email?.from_parsed?.[0]?.address ||
    email?.from ||
    'Unknown sender'
  );
}

function plainText(email) {
  if (email?.text) return email.text;
  if (email?.html) return email.html.replace(/<[^>]+>/g, ' ');
  return '';
}

// Pull likely one-time codes out of the body so you can copy them in one click.
function findCodes(email) {
  const body = plainText(email);
  if (!body) return [];
  const hits = new Set();
  for (const match of body.matchAll(/\b\d{4,8}\b/g)) hits.add(match[0]);
  for (const match of body.matchAll(/\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{5,8}\b/g)) {
    hits.add(match[0]);
  }
  return [...hits].slice(0, 4);
}

function frameDoc(html) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank"><style>html,body{margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#17181c;background:#fff;}img{max-width:100%;height:auto;}</style></head><body>${html}</body></html>`;
}

export default function Viewer({ defaultNamespace, onUnauthorized, onMissingKey }) {
  const [namespace, setNamespace] = useState(defaultNamespace || '');
  const [tag, setTag] = useState('');
  const [mode, setMode] = useState('exact');
  const [since, setSince] = useState(0);
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);
  const [refreshMs, setRefreshMs] = useState(0);
  const [search, setSearch] = useState('');

  const [emails, setEmails] = useState([]);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState({ loading: true, error: '', note: '' });
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState('html');
  const [copied, setCopied] = useState('');

  const listRef = useRef(null);

  // Held in refs so a new inline callback from the parent can't retrigger the query.
  const unauthorizedRef = useRef(onUnauthorized);
  const missingKeyRef = useRef(onMissingKey);
  useEffect(() => {
    unauthorizedRef.current = onUnauthorized;
    missingKeyRef.current = onMissingKey;
  });

  const address = `${namespace || 'namespace'}.${tag || '*'}${DOMAIN}`;

  const load = useCallback(async () => {
    if (!namespace) {
      setStatus({ loading: false, error: 'Enter a namespace to query.', note: '' });
      return;
    }
    setStatus((s) => ({ ...s, loading: true, error: '' }));

    const params = new URLSearchParams({
      namespace,
      limit: String(limit),
      offset: String(offset),
      headers: 'true',
      spam_report: 'true',
    });
    if (tag) params.set(mode === 'prefix' ? 'tag_prefix' : 'tag', tag);
    if (since) params.set('timestamp_from', String(Date.now() - since));

    try {
      const res = await fetch(`/api/inbox?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();

      if (res.status === 401) {
        unauthorizedRef.current?.();
        return;
      }
      if (res.status === 428) {
        missingKeyRef.current?.();
        return;
      }
      if (data.result !== 'success') {
        setEmails([]);
        setCount(0);
        setStatus({ loading: false, error: data.message || 'Query failed.', note: '' });
        return;
      }

      const list = data.emails || [];
      setEmails(list);
      setCount(data.count || 0);
      setStatus({ loading: false, error: '', note: data.message || '' });
      setSelectedId((current) =>
        list.some((e) => e.id === current) ? current : list[0]?.id ?? null,
      );
    } catch (error) {
      setStatus({ loading: false, error: error?.message || 'Request failed.', note: '' });
    }
  }, [namespace, tag, mode, since, limit, offset]);

  // Any change to the query (namespace, tag, match mode, paging) re-runs it,
  // debounced so typing a tag doesn't fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
  }, [load]);

  useEffect(() => {
    if (!refreshMs) return undefined;
    const id = setInterval(load, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return emails;
    return emails.filter((e) =>
      [e.subject, e.from, e.tag, e.to].join(' ').toLowerCase().includes(needle),
    );
  }, [emails, search]);

  const selected = visible.find((e) => e.id === selectedId) || visible[0] || null;

  // j / k to walk the list, like a mail client
  useEffect(() => {
    function onKey(event) {
      const tagName = event.target?.tagName;
      if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA') return;
      if (event.key !== 'j' && event.key !== 'k') return;
      const index = visible.findIndex((e) => e.id === selected?.id);
      const next = event.key === 'j' ? index + 1 : index - 1;
      if (next >= 0 && next < visible.length) {
        event.preventDefault();
        setSelectedId(visible[next].id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, selected]);

  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(''), 1400);
    return () => clearTimeout(id);
  }, [copied]);

  async function copy(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setStatus((s) => ({ ...s, error: 'Clipboard is blocked in this browser.' }));
    }
  }

  function resetPaging() {
    setOffset(0);
  }

  const codes = selected ? findCodes(selected) : [];
  const attachments = selected?.attachments || [];
  const from = emails.length ? offset + 1 : 0;
  const to = offset + emails.length;

  return (
    <main className="shell">
      <section className="address">
        <div className="address-line">
          <input
            className="seg"
            value={namespace}
            onChange={(event) => {
              setNamespace(event.target.value.trim());
              resetPaging();
            }}
            placeholder="namespace"
            aria-label="Namespace"
            size={Math.max(namespace.length || 9, 4)}
            spellCheck={false}
          />
          <span className="seg-fixed">.</span>
          <input
            className="seg seg-tag"
            value={tag}
            onChange={(event) => {
              setTag(event.target.value.trim());
              resetPaging();
            }}
            onKeyDown={(event) => event.key === 'Enter' && load()}
            placeholder="tag"
            aria-label="Tag"
            size={Math.max(tag.length || 3, 3)}
            spellCheck={false}
          />
          <span className="seg-fixed">{DOMAIN}</span>
        </div>

        <div className="address-controls">
          <button className="btn" onClick={() => copy(address, 'address')}>
            {copied === 'address' ? 'Copied' : 'Copy address'}
          </button>

          <label className="field">
            Match
            <select
              className="select"
              value={mode}
              onChange={(event) => {
                setMode(event.target.value);
                resetPaging();
              }}
            >
              <option value="exact">Exact tag</option>
              <option value="prefix">Tag starts with</option>
            </select>
          </label>

          <label className="field">
            Received
            <select
              className="select"
              value={since}
              onChange={(event) => {
                setSince(Number(event.target.value));
                resetPaging();
              }}
            >
              {SINCE.map((option) => (
                <option key={option.label} value={option.ms}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <span className="spacer" />

          <input
            className="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter loaded mail"
            aria-label="Filter loaded mail"
          />

          <label className="field">
            {refreshMs ? <span className="live-dot" aria-hidden="true" /> : null}
            <select
              className="select"
              value={refreshMs}
              onChange={(event) => setRefreshMs(Number(event.target.value))}
              aria-label="Auto refresh"
            >
              {REFRESH.map((option) => (
                <option key={option.label} value={option.ms}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button className="btn btn-primary" onClick={load} disabled={status.loading}>
            {status.loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </section>

      {status.error ? <p className="notice notice-error">{status.error}</p> : null}

      <section className="panes">
        <div className="pane pane-list">
          <div className="pane-head">
            <span>
              {count} {count === 1 ? 'email' : 'emails'} matched
            </span>
            <span className="spacer" />
            <span>j / k to move</span>
          </div>

          <div className="list" ref={listRef}>
            {visible.length === 0 ? (
              <div className="empty">
                <strong>{status.loading ? 'Loading…' : 'Nothing here yet'}</strong>
                <span>
                  Send mail to <code>{address}</code>
                </span>
              </div>
            ) : (
              visible.map((email) => (
                <button
                  key={email.id}
                  className="row"
                  aria-current={email.id === selected?.id}
                  onClick={() => setSelectedId(email.id)}
                >
                  <span className="row-top">
                    <span className="row-from">{senderName(email)}</span>
                    <span className="row-time">{timeAgo(email.timestamp)}</span>
                  </span>
                  <span className="row-subject">{email.subject || '(no subject)'}</span>
                  <span className="row-meta">
                    <span className="tag-chip">{email.tag || 'no tag'}</span>
                    {email.attachments?.length ? (
                      <span className="tag-chip">{email.attachments.length} attached</span>
                    ) : null}
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="pager">
            <button
              className="btn btn-quiet"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              Newer
            </button>
            <span>
              {from}–{to} of {count}
            </span>
            <button
              className="btn btn-quiet"
              disabled={to >= count}
              onClick={() => setOffset(offset + limit)}
            >
              Older
            </button>
            <span className="spacer" />
            <select
              className="select"
              value={limit}
              onChange={(event) => {
                setLimit(Number(event.target.value));
                setOffset(0);
              }}
              aria-label="Emails per page"
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} per page
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="pane">
          {!selected ? (
            <div className="empty">
              <strong>No email selected</strong>
              <span>Pick one from the list, or refresh once mail arrives.</span>
            </div>
          ) : (
            <div className="reader">
              <header className="reader-head">
                <h1 className="reader-subject">{selected.subject || '(no subject)'}</h1>
                <dl className="meta">
                  <dt>From</dt>
                  <dd>{selected.from || '—'}</dd>
                  <dt>To</dt>
                  <dd>{selected.to || '—'}</dd>
                  <dt>Tag</dt>
                  <dd className="mono">{selected.tag || '—'}</dd>
                  <dt>Received</dt>
                  <dd>{fullTime(selected.timestamp)}</dd>
                  {typeof selected.spam_score === 'number' ? (
                    <>
                      <dt>Spam</dt>
                      <dd>
                        {selected.spam_score.toFixed(2)}
                        {selected.spam_score >= 5 ? ' — over the usual threshold of 5' : ''}
                      </dd>
                    </>
                  ) : null}
                </dl>
              </header>

              {codes.length ? (
                <div className="codes">
                  <span>Codes found</span>
                  {codes.map((code) => (
                    <button
                      key={code}
                      className="code-chip"
                      onClick={() => copy(code, code)}
                      title="Copy code"
                    >
                      {copied === code ? 'Copied' : code}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="tabs" role="tablist">
                {['html', 'text', 'headers', 'json'].map((name) => (
                  <button
                    key={name}
                    role="tab"
                    className="tab"
                    aria-selected={tab === name}
                    onClick={() => setTab(name)}
                  >
                    {name === 'json' ? 'Raw JSON' : name[0].toUpperCase() + name.slice(1)}
                  </button>
                ))}
                <span className="spacer" />
                {selected.downloadUrl ? (
                  <a
                    className="btn btn-quiet"
                    href={selected.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ marginBottom: 6 }}
                  >
                    Download source
                  </a>
                ) : null}
              </div>

              <div className="body">
                {tab === 'html' ? (
                  selected.html ? (
                    <iframe
                      title="Email body"
                      sandbox="allow-popups allow-popups-to-escape-sandbox"
                      srcDoc={frameDoc(selected.html)}
                    />
                  ) : (
                    <pre>This email has no HTML part.</pre>
                  )
                ) : null}
                {tab === 'text' ? (
                  <pre>{selected.text || 'This email has no plain text part.'}</pre>
                ) : null}
                {tab === 'headers' ? (
                  <pre>
                    {(selected.headers || []).map((h) => h.line).join('\n') ||
                      'No headers returned.'}
                  </pre>
                ) : null}
                {tab === 'json' ? <pre>{JSON.stringify(selected, null, 2)}</pre> : null}
              </div>

              {attachments.length ? (
                <div className="attachments">
                  <span>Attachments</span>
                  {attachments.map((file, index) => {
                    const name = file.filename || file.fileName || `file-${index + 1}`;
                    return file.downloadUrl ? (
                      <a
                        key={name + index}
                        className="attachment"
                        href={file.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {name}
                      </a>
                    ) : (
                      <span key={name + index} className="attachment">
                        {name}
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <p className="foot">
        Reading <span style={{ fontFamily: 'var(--mono)' }}>{address}</span> through the{' '}
        <a href="https://testmail.app/docs/" target="_blank" rel="noreferrer">
          testmail.app JSON API
        </a>
        . Your key is decrypted server-side for each request and never reaches this page.
      </p>
    </main>
  );
}
