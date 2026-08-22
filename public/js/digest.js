const content = document.getElementById('content');
const pageSub = document.getElementById('pageSub');

function section(title, rows, emptyText) {
  return `<div class="card" style="margin-bottom:16px;">
    <h3 style="margin-bottom:8px;">${title}</h3>
    ${rows.length ? rows.join('') : `<p class="muted" style="font-size:13px;margin:0;">${emptyText}</p>`}
  </div>`;
}

function render(data) {
  if (!data.ready) {
    const msg = data.reason === 'not_connected'
      ? 'Connect to Hattrick first — see Settings.'
      : 'Not enough tracked history yet. The digest compares your two most recent syncs, so check back after your next scheduled sync.';
    content.innerHTML = `<div class="empty-state"><b>Digest not ready yet</b>${msg}</div>`;
    pageSub.textContent = '';
    return;
  }

  pageSub.textContent = `Comparing ${formatDate(data.previousDate)} → ${formatDate(data.currentDate)}`;

  const tsiDelta = formatDelta(data.team.tsiDelta);
  const worthDelta = formatDelta(data.team.worthDelta);
  const cashDelta = formatDelta(data.team.cashDelta);

  const statBar = `<div class="grid cols-3" style="margin-bottom:16px;">
    <div class="card stat-tile"><span class="caption">Team TSI change</span><span class="delta ${tsiDelta.cls}" style="font-size:16px;padding:4px 8px;">${tsiDelta.text}</span></div>
    <div class="card stat-tile"><span class="caption">Team Worth change (est.)</span><span class="delta ${worthDelta.cls}" style="font-size:16px;padding:4px 8px;">${worthDelta.text}</span></div>
    <div class="card stat-tile"><span class="caption">Cash change</span><span class="delta ${cashDelta.cls}" style="font-size:16px;padding:4px 8px;">${cashDelta.text}</span></div>
  </div>`;

  const levelUpRows = data.levelUps.map((l) => `<div class="player-row">
    <span class="name"><a href="/player.html?id=${l.playerId}" style="color:inherit;text-decoration:none;">${l.name}</a></span>
    <span class="meta">${l.skill}</span>
    <span class="right">${l.from} → <b>${l.to}</b></span>
  </div>`);

  const injuryRows = data.newInjuries.map((i) => `<div class="player-row">
    <span class="name"><a href="/player.html?id=${i.playerId}" style="color:inherit;text-decoration:none;">${i.name}</a></span>
    <span class="right chip critical">out ~${i.weeks}w</span>
  </div>`);

  const recoveredRows = data.recovered.map((r) => `<div class="player-row">
    <span class="name"><a href="/player.html?id=${r.playerId}" style="color:inherit;text-decoration:none;">${r.name}</a></span>
    <span class="right chip good">back fit</span>
  </div>`);

  const moverRows = data.valueMovers.map((m) => `<div class="player-row">
    <span class="name"><a href="/player.html?id=${m.playerId}" style="color:inherit;text-decoration:none;">${m.name}</a></span>
    <span class="right ${m.delta >= 0 ? '' : ''}" style="color:${m.delta >= 0 ? 'var(--sb-status-good-text)' : 'var(--sb-status-critical-text)'};">${m.delta >= 0 ? '+' : ''}${formatNumber(m.delta)}</span>
  </div>`);

  content.innerHTML = statBar
    + section('Skill level-ups', levelUpRows, 'No level-ups since last sync.')
    + section('New injuries', injuryRows, 'No new injuries.')
    + section('Back from injury', recoveredRows, 'No returns this week.')
    + section('Biggest value movers (est.)', moverRows, 'No notable value moves.');
}

async function load() {
  try {
    const data = await apiGet('/api/digest');
    render(data);
  } catch (err) {
    content.innerHTML = `<div class="banner error">${err.message}</div>`;
  }
}

load();
