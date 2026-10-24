const content = document.getElementById('content');
const pageSub = document.getElementById('pageSub');
const syncBtn = document.getElementById('syncBtn');

let currentFilter = 'ALL';

function notConnectedState() {
  content.innerHTML = CHPP_ENABLED
    ? `<div class="empty-state">
      <b>No CHPP connection yet</b>
      Connect your Hattrick account to load your squad. <a href="/settings.html">Go to Settings →</a>
    </div>`
    : `<div class="empty-state">
      <b>No squad data yet</b>
      Upload your Hattrick players export under <a href="/settings.html">Settings → Data upload</a>.
    </div>`;
  pageSub.textContent = CHPP_ENABLED ? 'Not connected' : 'No data yet';
  syncBtn.disabled = CHPP_ENABLED;
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
      <div class="card-head"><h3>Team TSI</h3><span class="muted" style="font-size:12px">trend over tracked history</span></div>
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

function playerLink(id, name) {
  return `<a class="name" href="/player.html?id=${id}" style="color:inherit;text-decoration:none;">${esc(name)}</a>`;
}

// Needs attention: who's out, and who may be worth selling now (with why).
function needsAttentionRows(data) {
  const na = data.needsAttention || {};
  const rows = [];
  for (const p of na.injured || []) {
    rows.push(`<div class="player-row">${playerLink(p.playerId, p.name)}
      <span class="right chip critical">injured, ~${p.weeks}w</span></div>`);
  }
  for (const c of data.sellCandidates || []) {
    rows.push(`<div class="player-row sell-row">
      <div>${playerLink(c.playerId, c.name)} <span class="muted" style="font-size:11.5px;">${c.positionCode} · ${c.ageYears} · ~${formatNumber(c.valueEstimate)}</span>
        <div class="muted" style="font-size:11.5px;">${c.reasons.map(esc).join(' · ')}</div></div>
      <span class="right chip warning">sell window?</span>
    </div>`);
  }
  return rows;
}

// The old Weekly Digest, condensed: what changed between the two latest imports.
function sinceLastImportCard(data) {
  const c = data.changes;
  if (!c || !c.ready) {
    return `<div class="card" style="margin-top:16px;"><h3 style="margin-bottom:6px;">Since the last import</h3>
      <p class="muted" style="font-size:13px;margin:0;">Needs two imports to compare.</p></div>`;
  }
  const list = (title, rows, empty) => `<div><h4 class="upload-sub">${title}</h4>${rows.length ? rows.join('') : `<p class="muted" style="font-size:12.5px;margin:0;">${empty}</p>`}</div>`;
  const levelUps = c.levelUps.map((l) => `<div class="player-row">${playerLink(l.playerId, l.name)}
    <span class="right">${l.skill} ${l.from} → <b>${l.to}</b></span></div>`);
  const injuries = [
    ...c.newInjuries.map((i) => `<div class="player-row">${playerLink(i.playerId, i.name)}<span class="right chip critical">out ~${i.weeks}w</span></div>`),
    ...c.recovered.map((r) => `<div class="player-row">${playerLink(r.playerId, r.name)}<span class="right chip good">back fit</span></div>`),
  ];
  const movers = c.valueMovers.slice(0, 6).map((m) => `<div class="player-row">${playerLink(m.playerId, m.name)}
    <span class="right" style="color:${m.delta >= 0 ? 'var(--sb-status-good-text)' : 'var(--sb-status-critical-text)'};">${m.delta >= 0 ? '+' : ''}${formatNumber(m.delta)}</span></div>`);
  return `<div class="card" style="margin-top:16px;">
    <h3 style="margin-bottom:10px;">Since the last import <span class="muted" style="font-size:12px;font-weight:400;">${formatDate(c.previousDate)} → ${formatDate(c.currentDate)}</span></h3>
    <div class="grid cols-3">
      ${list('Level-ups', levelUps, 'No level-ups.')}
      ${list('Injuries', injuries, 'No new injuries or returns.')}
      ${list('Value movers (est.)', movers, 'No value changes.')}
    </div>
  </div>`;
}

function renderInsightRow(data) {
  const naRows = needsAttentionRows(data);
  // A CHPP sync reports income and costs exactly. A CSV import only has the
  // cash balance, so there the week's result is the change in cash since
  // the previous snapshot, per week elapsed — which includes transfers.
  let fromCash = false;
  const netPoints = data.snapshots.map((s, i) => {
    let value = null;
    if (s.weekly_income != null && s.weekly_expenses != null) {
      value = s.weekly_income - s.weekly_expenses;
    } else {
      const prev = data.snapshots[i - 1];
      if (prev && prev.cash != null && s.cash != null) {
        const weeks = Math.max(1, Math.round((new Date(s.snapshot_date) - new Date(prev.snapshot_date)) / (7 * 24 * 3600 * 1000)));
        value = Math.round((s.cash - prev.cash) / weeks);
        fromCash = true;
      }
    }
    return { label: s.snapshot_date.slice(5), value };
  });
  const hasNetData = netPoints.some((p) => p.value != null);
  const netTitle = fromCash ? 'Weekly cash change' : 'Weekly net income';
  const netCaption = fromCash
    ? `change in cash between imports, incl. transfers · wage bill ${formatNumber(data.weeklyWageBill)}/wk`
    : `income − costs, est. wage bill ${formatNumber(data.weeklyWageBill)}/wk`;

  return `<div class="grid cols-2">
    <div class="card">
      <h3 style="margin-bottom:2px;">Needs attention</h3>
      <p class="muted" style="font-size:11.5px;margin:0 0 8px;">Injuries, and players where selling soon is worth a look (estimates, not a verdict).</p>
      ${naRows.length ? naRows.join('') : needsAttentionEmptyState(data)}
    </div>
    <div class="card chart-card">
      <div class="card-head"><h3>${netTitle}</h3><span class="muted" style="font-size:12px;">${netCaption}</span></div>
      ${hasNetData
        ? `<div class="plot">${Charts.divergingBarChart(netPoints)}</div>`
        : `<p class="muted" style="font-size:12.5px;margin:0;">Needs two imports with your cash balance filled in (Settings → Data upload).</p>`}
    </div>
  </div>` + sinceLastImportCard(data);
}

function needsAttentionEmptyState() {
  return '<p class="muted" style="font-size:13px;margin:0;">Nothing needs attention: no injuries, and no sell signals.</p>';
}

function playerCardHtml(p) {
  const flags = [];
  if (p.injuryWeeks > 0) flags.push(`<span class="chip critical">● Injured, ~${p.injuryWeeks}w</span>`);
  if (p.transferListed) flags.push(`<span class="chip gold">★ Listed</span>`);
  return `<a class="player-card" href="/player.html?id=${p.playerId}">
    <div class="top">
      <div class="avatar">${esc(initials(p.name))}</div>
      <div>
        <div class="name">${esc(p.name)}</div>
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
  if (data.dataSource !== 'csv' || !CHPP_ENABLED) return '';
  return `<div class="banner info" style="margin-bottom:16px;">
    This is CSV-imported data, not a live Hattrick connection — training ETAs and match ratings won't
    accumulate history until you either re-import periodically or connect via CHPP.
    <a href="/settings.html">Manage in Settings →</a>
  </div>`;
}

// The trends and training models learn from weekly snapshots; a missed week
// is a gap in every one of them.
function staleBanner(data) {
  if (data.dataSource !== 'csv' || !data.lastSyncAt) return '';
  const days = Math.floor((Date.now() - new Date(data.lastSyncAt).getTime()) / (24 * 3600 * 1000));
  if (days < 7) return '';
  return `<div class="banner error" style="margin-bottom:16px;">
    <b>Last upload ${days} days ago.</b> Time for the weekly update, so the trends and training models keep learning.
    <a href="/settings.html">Upload now →</a>
  </div>`;
}

function render(data) {
  content.innerHTML = staleBanner(data) + csvSourceBanner(data) + renderStatBar(data) + renderCharts(data)
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
    const sourceNote = data.dataSource === 'csv' && CHPP_ENABLED ? ' · CSV import' : '';
    const when = data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleString() : 'never';
    pageSub.textContent = `${data.teamName || 'Your team'} · last ${data.dataSource === 'csv' ? 'import' : 'synced'} ${when}${sourceNote}`;
    syncBtn.disabled = false;
    syncBtn.textContent = data.dataSource === 'csv' ? '↑ Upload data' : '↻ Sync now';
    render(data);
  } catch (err) {
    content.innerHTML = `<div class="banner error">${esc(err.message)}</div>`;
  }
}

syncBtn.addEventListener('click', async () => {
  if (currentDataSource !== 'chpp' || !CHPP_ENABLED) {
    location.href = '/settings.html';
    return;
  }
  syncBtn.disabled = true;
  syncBtn.textContent = 'Syncing…';
  try {
    await apiPost('/api/chpp/sync-now');
    await load();
  } catch (err) {
    content.insertAdjacentHTML('afterbegin', `<div class="banner error">${esc(err.message)}</div>`);
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = '↻ Sync now';
  }
});

load();
