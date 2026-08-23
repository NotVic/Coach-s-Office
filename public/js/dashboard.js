const content = document.getElementById('content');
const pageSub = document.getElementById('pageSub');
const syncBtn = document.getElementById('syncBtn');

let currentFilter = 'ALL';

function notConnectedState() {
  content.innerHTML = `<div class="empty-state">
    <b>No CHPP connection yet</b>
    Connect your Hattrick account to load your squad. <a href="/settings.html">Go to Settings →</a>
  </div>`;
  pageSub.textContent = 'Not connected';
  syncBtn.disabled = true;
}

function renderStatBar(data) {
  const players = data.players;
  const avgAge = players.length
    ? (players.reduce((s, p) => s + (p.ageYears || 0), 0) / players.length).toFixed(1)
    : '—';
  const tsiDelta = data.previous ? formatDelta(data.latest.team_tsi - data.previous.team_tsi) : { text: '—', cls: 'flat' };
  const worthDelta = data.previous ? formatDelta(data.latest.team_worth - data.previous.team_worth) : { text: '—', cls: 'flat' };

  return `<div class="card" style="display:flex;gap:32px;align-items:center;padding:12px 18px;margin-bottom:16px;flex-wrap:wrap;">
    <div><span class="caption">Team TSI</span><br><span class="mono" style="font-weight:600;font-size:16px;">${formatNumber(data.latest?.team_tsi)}</span> <span class="delta ${tsiDelta.cls}" style="margin-left:4px;">${tsiDelta.text}</span></div>
    <div><span class="caption">Team Worth (est.)</span><br><span class="mono" style="font-weight:600;font-size:16px;">~${formatNumber(data.latest?.team_worth)}</span> <span class="delta ${worthDelta.cls}" style="margin-left:4px;">${worthDelta.text}</span></div>
    <div><span class="caption">Squad size</span><br><span class="mono" style="font-weight:600;font-size:16px;">${players.length}</span></div>
    <div><span class="caption">Avg. age</span><br><span class="mono" style="font-weight:600;font-size:16px;">${avgAge}</span></div>
  </div>`;
}

function renderCharts(data) {
  const tsiPoints = data.snapshots.map((s) => ({ label: s.snapshot_date.slice(5), value: s.team_tsi }));
  const worthPoints = data.snapshots.map((s) => ({ label: s.snapshot_date.slice(5), value: s.team_worth }));

  const ageBars = Object.entries(data.ageDistribution)
    .sort((a, b) => (a[0] === 'Unknown' ? 1 : b[0] === 'Unknown' ? -1 : Number(a[0]) - Number(b[0])))
    .map(([label, value]) => ({ label, value }));

  const posBars = [
    { label: 'GK', value: data.positionComposition.gk },
    { label: 'DEF', value: data.positionComposition.def },
    { label: 'MID', value: data.positionComposition.mid },
    { label: 'ATT', value: data.positionComposition.att },
  ];

  return `<div class="grid cols-4">
    <div class="card chart-card">
      <div class="card-head"><h3>Team TSI</h3><span class="muted" style="font-size:12px">trend since connecting</span></div>
      <div class="plot">${Charts.lineChart(tsiPoints, { color: 'var(--sb-accent)' })}</div>
    </div>
    <div class="card chart-card">
      <div class="card-head"><h3>Team Worth</h3><span class="muted" style="font-size:12px">~ estimated, see Settings</span></div>
      <div class="plot">${Charts.lineChart(worthPoints, { color: 'var(--sb-accent-gold)' })}</div>
    </div>
    <div class="card chart-card">
      <div class="card-head"><h3>Age Distribution</h3><span class="muted" style="font-size:12px">${data.players.length} players</span></div>
      <div class="plot">${Charts.barChart(ageBars)}</div>
    </div>
    <div class="card chart-card">
      <div class="card-head"><h3>Squad Composition</h3><span class="muted" style="font-size:12px">by line</span></div>
      <div class="plot">${Charts.barChart(posBars, { color: 'var(--sb-accent)' })}</div>
    </div>
  </div>`;
}

function needsAttentionRows(data) {
  const na = data.needsAttention || {};
  const rows = [];
  for (const p of na.injured || []) {
    rows.push(`<div class="player-row">
      <a class="name" href="/player.html?id=${p.playerId}" style="color:inherit;text-decoration:none;">${p.name}</a>
      <span class="right chip critical">injured, ~${p.weeks}w</span>
    </div>`);
  }
  for (const l of na.levelUps || []) {
    rows.push(`<div class="player-row">
      <a class="name" href="/player.html?id=${l.playerId}" style="color:inherit;text-decoration:none;">${l.name}</a>
      <span class="right chip good">${l.skill} ${l.from}→${l.to} — review lineup/wage</span>
    </div>`);
  }
  for (const m of na.fallingValue || []) {
    rows.push(`<div class="player-row">
      <a class="name" href="/player.html?id=${m.playerId}" style="color:inherit;text-decoration:none;">${m.name}</a>
      <span class="right chip warning">value est. ${formatNumber(m.delta)} — possible sell window</span>
    </div>`);
  }
  return rows;
}

function renderInsightRow(data) {
  const naRows = needsAttentionRows(data);
  const netPoints = data.snapshots.map((s) => ({
    label: s.snapshot_date.slice(5),
    value: s.weekly_income != null && s.weekly_expenses != null ? s.weekly_income - s.weekly_expenses : null,
  }));

  return `<div class="grid cols-2">
    <div class="card">
      <h3 style="margin-bottom:8px;">Needs attention</h3>
      ${naRows.length ? naRows.join('') : needsAttentionEmptyState(data)}
    </div>
    <div class="card chart-card">
      <div class="card-head"><h3>Weekly net income</h3><span class="muted" style="font-size:12px;">income − costs, est. wage bill ${formatNumber(data.weeklyWageBill)}/wk</span></div>
      <div class="plot">${Charts.divergingBarChart(netPoints)}</div>
    </div>
  </div>`;
}

function needsAttentionEmptyState(data) {
  if (!data.needsAttention?.hasRecentChanges) {
    return '<p class="muted" style="font-size:13px;margin:0;">Nothing yet — this fills in once there are at least two syncs to compare, and any current injuries.</p>';
  }
  return '<p class="muted" style="font-size:13px;margin:0;">Nothing needs attention right now.</p>';
}

function playerCardHtml(p) {
  const flags = [];
  if (p.injuryWeeks > 0) flags.push(`<span class="chip critical">● Injured, ~${p.injuryWeeks}w</span>`);
  if (p.transferListed) flags.push(`<span class="chip gold">★ Listed</span>`);
  return `<a class="player-card" href="/player.html?id=${p.playerId}">
    <div class="top">
      <div class="avatar">${initials(p.name)}</div>
      <div>
        <div class="name">${p.name}</div>
        <div class="meta"><span class="pos ${posClass(p.positionCode)}">${p.positionCode}</span> · Age ${p.ageYears ?? '—'}</div>
      </div>
    </div>
    <div class="flags">${flags.join('')}</div>
    <div class="stats-row">
      <div>TSI<br><b>${formatNumber(p.tsi)}</b></div>
      <div>Value (est.)<br><b>~${formatNumber(p.valueEstimate)}</b></div>
    </div>
  </a>`;
}

function renderSquad(data) {
  const filtered = currentFilter === 'ALL' ? data.players : data.players.filter((p) => posClass(p.positionCode) === `pos-${currentFilter.toLowerCase()}`);
  const cards = filtered.map(playerCardHtml).join('') || '<div class="empty-state">No players match this filter.</div>';

  return `<div class="halfway"></div>
  <div class="page-head" style="margin-bottom:12px;">
    <h2>Squad</h2>
    <div class="filter-row" style="margin:0;">
      <div class="seg" id="posFilter">
        ${['ALL', 'GK', 'DEF', 'MID', 'ATT'].map((f) => `<button data-filter="${f}" class="${f === currentFilter ? 'active' : ''}">${f}</button>`).join('')}
      </div>
    </div>
  </div>
  <div class="squad-grid">${cards}</div>`;
}

function wireFilter(data) {
  document.getElementById('posFilter').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    currentFilter = btn.dataset.filter;
    render(data);
  });
}

function csvSourceBanner(data) {
  if (data.dataSource !== 'csv') return '';
  return `<div class="banner info" style="margin-bottom:16px;">
    This is CSV-imported data, not a live Hattrick connection — training ETAs and match ratings won't
    accumulate history until you either re-import periodically or connect via CHPP.
    <a href="/settings.html">Manage in Settings →</a>
  </div>`;
}

function render(data) {
  content.innerHTML = csvSourceBanner(data) + renderStatBar(data) + renderCharts(data)
    + `<div class="halfway"></div>` + renderInsightRow(data)
    + renderSquad(data);
  wireFilter(data);
}

let currentDataSource = null;

async function load() {
  try {
    const data = await apiGet('/api/dashboard');
    if (!data.connected) return notConnectedState();
    currentDataSource = data.dataSource;
    const sourceNote = data.dataSource === 'csv' ? ' · CSV import' : '';
    pageSub.textContent = `${data.teamName || 'Your team'} · last synced ${data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleString() : 'never'}${sourceNote}`;
    syncBtn.disabled = false;
    syncBtn.textContent = data.dataSource === 'csv' ? '↻ Manage in Settings' : '↻ Sync now';
    render(data);
  } catch (err) {
    content.innerHTML = `<div class="banner error">${err.message}</div>`;
  }
}

syncBtn.addEventListener('click', async () => {
  if (currentDataSource === 'csv') {
    location.href = '/settings.html';
    return;
  }
  syncBtn.disabled = true;
  syncBtn.textContent = 'Syncing…';
  try {
    await apiPost('/api/chpp/sync-now');
    await load();
  } catch (err) {
    content.insertAdjacentHTML('afterbegin', `<div class="banner error">${err.message}</div>`);
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = '↻ Sync now';
  }
});

load();
