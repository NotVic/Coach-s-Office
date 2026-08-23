// Small fetch wrapper — every endpoint returns JSON, errors come back as
// { error: "message" } with a non-2xx status.
// Attaches the full response body to the thrown Error (as `.data`) so a
// caller that needs more than the message — e.g. CSV import's per-row
// rowErrors array — can still get at it; everyone else just reads .message.
function apiError(path, res, data) {
  const err = new Error(data.error || `Request to ${path} failed (${res.status}).`);
  err.data = data;
  return err;
}

async function apiGet(path) {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError(path, res, data);
  return data;
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError(path, res, data);
  return data;
}

// Hattrick doesn't expose a single currency across all leagues via CHPP in
// a way this app resolves yet, so numbers are shown plain (thousands
// separators only) rather than guessing a currency symbol.
function formatNumber(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString('en-US');
}

function formatDelta(n, { plainZero = false } = {}) {
  if (n == null || Number.isNaN(n)) return { text: '—', cls: 'flat' };
  if (n === 0) return { text: plainZero ? '0' : 'No change', cls: 'flat' };
  const cls = n > 0 ? 'up' : 'down';
  const sign = n > 0 ? '+' : '−';
  return { text: `${sign}${formatNumber(Math.abs(n))}`, cls };
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function initials(name) {
  return (name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase())
    .slice(0, 2)
    .join('') || '?';
}

function posClass(code) {
  if (code === 'GK') return 'pos-gk';
  if (['CD', 'WB'].includes(code)) return 'pos-def';
  if (['IM', 'WI'].includes(code)) return 'pos-mid';
  return 'pos-att';
}
