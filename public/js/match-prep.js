const content = document.getElementById('content');
const pageSub = document.getElementById('pageSub');

function playerInitials(p) {
  return initials(`${p.first_name} ${p.last_name}`);
}

function lineupSection(lineup) {
  const slots = {
    gk: lineup.gk.map((p) => ({ code: playerInitials(p) })),
    def: lineup.def.map((p) => ({ code: playerInitials(p) })),
    mid: lineup.mid.map((p) => ({ code: playerInitials(p) })),
    att: lineup.att.map((p) => ({ code: playerInitials(p) })),
  };
  const allPlayers = [...lineup.gk, ...lineup.def, ...lineup.mid, ...lineup.att, ...lineup.fillers];
  const rows = allPlayers.map((p) => `<tr><td>${p.first_name} ${p.last_name}</td><td>${p.position_code}</td><td>${formatNumber(p.tsi)}</td></tr>`).join('');

  return `<div class="card" style="display:grid;grid-template-columns:280px 1fr;gap:24px;">
    <div>
      <div class="caption" style="margin-bottom:8px;">Suggested XI · ${lineup.formation}</div>
      ${Charts.pitchDiagram(slots)}
      <div style="display:flex;gap:12px;justify-content:center;margin-top:8px;font-size:11px;color:var(--sb-text-muted);">
        <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--sb-line-gk);margin-right:4px;"></span>GK</span>
        <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--sb-line-def);margin-right:4px;"></span>DEF</span>
        <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--sb-line-mid);margin-right:4px;"></span>MID</span>
        <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--sb-line-att);margin-right:4px;"></span>ATT</span>
      </div>
    </div>
    <div>
      <h3 style="margin-bottom:8px;">Selected players</h3>
      <p class="muted" style="font-size:12px;margin:0 0 8px;">
        Picked from your fit squad by best raw skill per line — a starting point, not a tactics engine. Injured players are excluded.
      </p>
      <table class="wf-table"><thead><tr><th>Player</th><th>Line</th><th>TSI</th></tr></thead><tbody>${rows}</tbody></table>
    </div>
  </div>`;
}

function outcomeSection(data) {
  if (!data.outcomeEstimate) {
    return `<div class="card chart-card">
      <div class="card-head"><h3>Predicted outcome</h3></div>
      <div class="empty-state">
        <b>Not available for this fixture</b>
        Your opponent's squad TSI isn't viewable via CHPP (their players list access is restricted), so an outcome estimate can't be modeled honestly here.
      </div>
    </div>`;
  }
  return `<div class="card chart-card">
    <div class="card-head"><h3>Predicted outcome</h3><span class="muted" style="font-size:12px;">modeled estimate</span></div>
    <div class="plot">${Charts.stackedProbBar(data.outcomeEstimate)}</div>
    <div style="margin-top:6px;font-size:11.5px;color:var(--sb-text-muted);">
      ~ Based on total squad TSI only — not a guarantee, and it doesn't know tactics, form on the day, or lineup choices.
    </div>
  </div>`;
}

function availabilitySection(list) {
  if (!list.length) return `<div class="card"><h3 style="margin-bottom:6px;">Availability</h3><p class="muted" style="font-size:13px;margin:0;">Full squad available — no injuries tracked.</p></div>`;
  const rows = list.map((p) => `<div class="player-row"><span class="name">${p.name}</span><span class="right chip critical">~${p.injuryWeeks}w</span></div>`).join('');
  return `<div class="card"><h3 style="margin-bottom:6px;">Availability</h3>${rows}</div>`;
}

function render(data) {
  if (!data.hasMatch) {
    content.innerHTML = `<div class="empty-state"><b>No upcoming fixture found</b>Check back closer to your next match, or sync from the Dashboard.</div>`;
    pageSub.textContent = 'No fixture scheduled';
    return;
  }

  const { match, opponent, ownTsi } = data;
  pageSub.textContent = `vs ${opponent.name || 'TBD'}${opponent.league?.name ? ' · ' + opponent.league.name : ''} · ${formatDate(match.date)} · ${match.isHome ? 'Home' : 'Away'}`;

  const tsiDiff = opponent.tsiAvailable ? ownTsi - opponent.tsi : null;

  content.innerHTML = `<div class="grid cols-4">
    <div class="card stat-tile">
      <span class="caption">Your team TSI</span>
      <span class="value mono-stat">${formatNumber(ownTsi)}</span>
      ${tsiDiff != null ? `<span class="delta ${tsiDiff >= 0 ? 'up' : 'down'}">${tsiDiff >= 0 ? '+' : ''}${formatNumber(tsiDiff)} vs opponent</span>` : `<span class="delta flat">opponent TSI unavailable</span>`}
    </div>
    <div class="card stat-tile">
      <span class="caption">Opponent</span>
      <span class="value" style="font-size:18px;">${opponent.name || '—'}</span>
      <span class="delta flat">${opponent.arena?.name || 'Arena unknown'}</span>
    </div>
    <div class="card stat-tile">
      <span class="caption">Venue</span>
      <span class="value">${match.isHome ? 'Home' : 'Away'}</span>
      <span class="delta flat">${formatDate(match.date)}</span>
    </div>
    <div class="card stat-tile">
      <span class="caption">Availability</span>
      <span class="value mono-stat">${data.availability.length === 0 ? 'Full squad' : `${data.availability.length} out`}</span>
      <span class="delta ${data.availability.length ? 'down' : 'flat'}">${data.availability.length ? 'see panel below' : 'no injuries'}</span>
    </div>
  </div>

  <div class="halfway"></div>

  <div class="grid cols-12">
    <div class="span-8" style="display:flex;flex-direction:column;gap:16px;">
      ${outcomeSection(data)}
      ${lineupSection(data.lineup)}
    </div>
    <div class="span-4" style="display:flex;flex-direction:column;gap:16px;">
      ${availabilitySection(data.availability)}
      <div class="card">
        <h3 style="margin-bottom:6px;">Opponent snapshot</h3>
        <p style="font-size:13px;color:var(--sb-text-secondary);margin:0 0 6px;">League: ${opponent.league?.name || '—'}</p>
        <p style="font-size:13px;color:var(--sb-text-secondary);margin:0;">Power rating: ${opponent.powerRating ?? '—'}</p>
        <p class="muted" style="font-size:11.5px;margin-top:8px;">Detailed opponent skills aren't available via CHPP unless you've scouted them in-game.</p>
      </div>
    </div>
  </div>`;
}

async function load() {
  try {
    const data = await apiGet('/api/match-prep');
    render(data);
  } catch (err) {
    content.innerHTML = `<div class="banner error">${err.message}</div>`;
    pageSub.textContent = '';
  }
}

load();
