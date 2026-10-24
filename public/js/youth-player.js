// One youth player in full: the call and its reasoning, every skill as
// current/potential, the training outlook with its assumptions, and what
// the imports have shown over time (level-ups, revelations, ratings).
const content = document.getElementById('content');

const SLOT_MARK = { primary: '● primary', secondary: '○ secondary' };

function header(d) {
  const p = d.player;
  const promo = p.promotableNow ? 'promotable now'
    : p.daysUntilPromotion != null ? `promotable in ~${Math.ceil(p.daysUntilPromotion / 7)} weeks` : 'promotion date unknown';
  return `<div class="card" style="margin-bottom:16px;">
    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">
      <div class="avatar lg">${esc(initials(p.name))}</div>
      <div style="flex:1;min-width:220px;">
        <h2 style="margin-bottom:2px;">${esc(p.name)}</h2>
        <div class="muted" style="font-size:13px;">
          ${p.age.years}y ${p.age.days}d · ${promo}${p.nationality ? ` · ${esc(p.nationality)}` : ''}
          ${p.specialty ? ` · <span class="chip gold">${esc(p.specialty)}</span>` : ''}
          ${p.injuryWeeks > 0 ? ` · <span class="chip critical">injured ~${p.injuryWeeks}w</span>` : ''}
        </div>
      </div>
      <span class="chip ${p.verdict.tone || ''}" style="font-size:13px;padding:5px 12px;">${esc(p.verdict.label)}</span>
    </div>
    <p style="font-size:13.5px;margin:12px 0 0;">${esc(p.verdict.why)}</p>
  </div>`;
}

function tiles(d) {
  const p = d.player;
  const b = p.bestPotential;
  return `<div class="grid cols-4" style="margin-bottom:16px;">
    <div class="card stat-tile"><span class="caption">Ceiling</span>
      <span class="value" style="font-size:20px;">${b ? `${b.atLeast ? '≥ ' : ''}${b.level} ${esc(b.label)}` : '—'}</span>
      <span class="delta flat">${b ? `${b.atLeast ? 'at least ' : ''}${esc(b.name)} · ${p.ceiling} ceiling` : 'nothing revealed yet'}</span></div>
    <div class="card stat-tile"><span class="caption">Revealed</span>
      <span class="value mono-stat">${p.revealedPct}%</span>
      <span class="delta flat">of the 14 current/potential values</span></div>
    <div class="card stat-tile"><span class="caption">Role</span>
      <span class="value" style="font-size:20px;"><span class="pos ${posClass(p.suggestedRole)}">${p.suggestedRole}</span></span>
      <span class="delta flat">from where the player can end up</span></div>
    <div class="card stat-tile"><span class="caption">Last match</span>
      <span class="value mono-stat">${p.lastMatch.rating != null ? `${p.lastMatch.rating}★` : '—'}</span>
      <span class="delta flat">${p.lastMatch.position ? `${esc(p.lastMatch.position)} · ` : ''}${p.lastMatch.date ? formatDate(p.lastMatch.date) : 'no match yet'}</span></div>
  </div>`;
}

function skillsCard(d) {
  const rows = d.player.skills.map((s) => {
    const status = s.maxedOut ? '<span class="chip good">maxed out</span>'
      : s.headroom != null ? `+${s.headroom} to go`
        : s.current == null && s.potential == null ? '<span class="muted">nothing revealed</span>'
          : '<span class="muted">headroom unknown</span>';
    return `<tr>
      <td style="font-family:inherit;"><b>${esc(s.label)}</b></td>
      <td>${s.current ?? '?'} <span class="muted">${s.currentName ? esc(s.currentName) : ''}</span></td>
      <td>${s.potential ?? '?'} <span class="muted">${s.potentialName ? esc(s.potentialName) : ''}</span></td>
      <td style="font-family:inherit;">${status}</td>
      <td style="font-family:inherit;">${s.trained ? SLOT_MARK[s.trained] : '<span class="muted">not trained</span>'}</td>
    </tr>`;
  }).join('');
  return `<div class="card" style="overflow-x:auto;">
    <h3 style="margin-bottom:8px;">Skills</h3>
    <table class="wf-table">
      <thead><tr><th>Skill</th><th>Current</th><th>Potential</th><th>Status</th><th>Training now</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function outlookCard(d) {
  const items = d.player.outlook;
  const t = d.training;
  const head = `<h3 style="margin-bottom:4px;">Training outlook</h3>
    <p class="muted" style="font-size:12px;margin:0 0 10px;">${t && (t.primary || t.secondary)
      ? `Academy training: ${esc(t.primary?.label ?? '—')} / ${esc(t.secondary?.label ?? '—')}. Model calibration ×${d.calibration.factor.toFixed(2)} (${d.calibration.confidence} confidence).`
      : 'No youth training reported at the last import.'}</p>`;
  if (!items.length) {
    return `<div class="card">${head}<p class="muted" style="font-size:13px;margin:0;">The current training doesn't reach a skill with a known level for this player.</p></div>`;
  }
  const body = items.map((o) => {
    const name = `<b>${esc(o.skill)}</b> <span class="muted">${o.slots.map((s) => SLOT_MARK[s]).join(' + ')}</span>`;
    if (o.status === 'maxed') return `<div class="player-row"><span>${name}</span><span class="right chip good">maxed out</span></div>`;
    if (o.status !== 'ok') return `<div class="player-row"><span>${name}</span><span class="right muted">not reached from this position</span></div>`;
    const pot = o.toPotential
      ? `potential ${o.potential} in ~${o.toPotential.low}–${o.toPotential.high} wk${{ yes: ' (before 19)', tight: ' (tight before 19)', no: ' (after 19)' }[o.toPotential.beforeAgeOut]}`
      : 'potential unknown';
    return `<div style="padding:8px 0;border-bottom:1px solid var(--sb-border);">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <span>${name}</span>
        <span class="mono" style="font-size:12.5px;">${o.current} → ${o.current + 1} in ~${o.nextLevel.low}–${o.nextLevel.high} wk · ${pot}</span>
      </div>
      <div class="muted" style="font-size:11.5px;margin-top:3px;">
        ~${o.weeksPerLevel} weeks per level ·
        ${o.bankedPct != null ? `~${o.bankedPct}% banked since the last level-up` : 'progress since the last level-up unknown (wide range)'}
        ${o.observed ? ` · observed in this player's history: ~${o.observed.low}–${o.observed.high} wk` : ''}
        · ${o.tiers.map(esc).join(', ')}<br>${o.assumptions.map(esc).join(' · ')}
      </div>
    </div>`;
  }).join('');
  return `<div class="card">${head}${body}</div>`;
}

function historyCards(d) {
  const shortDate = (s) => (s || '').slice(5);
  const skillCharts = d.history
    .map((h) => ({ ...h, known: h.points.filter((x) => x.current != null) }))
    .filter((h) => h.known.length >= 2)
    .map((h) => `<div class="card chart-card">
      <div class="card-head"><h3>${esc(h.label)}</h3><span class="muted" style="font-size:12px;">current level per import</span></div>
      <div class="plot">${Charts.lineChart(h.known.map((x) => ({ label: shortDate(x.date), value: x.current })), { valueFormat: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)) })}</div>
    </div>`);
  const ratings = d.player.ratingHistory;
  if (ratings.length >= 2) {
    skillCharts.push(`<div class="card chart-card">
      <div class="card-head"><h3>Match ratings</h3><span class="muted" style="font-size:12px;">last match, per import</span></div>
      <div class="plot">${Charts.lineChart(ratings.map((r) => ({ label: shortDate(r.date), value: r.rating })), { color: 'var(--sb-accent-gold)', valueFormat: (v) => v.toFixed(1) })}</div>
    </div>`);
  }
  const timeline = d.timeline.length
    ? d.timeline.map((e) => `<div class="player-row"><span>${esc(e.text)}</span>
        <span class="right"><span class="chip ${e.kind === 'level-up' ? 'good' : 'gold'}">${e.kind}</span> <span class="muted" style="font-size:11.5px;">${formatDate(e.date)}</span></span></div>`).join('')
    : `<p class="muted" style="font-size:13px;margin:0;">Nothing yet: level-ups and revelations show up here from the second import on${d.firstImport ? ` (tracked since ${formatDate(d.firstImport)})` : ''}.</p>`;

  return `<div class="halfway"></div>
    <h2 style="margin-bottom:12px;">History</h2>
    ${skillCharts.length ? `<div class="grid cols-3" style="margin-bottom:16px;">${skillCharts.join('')}</div>` : ''}
    <div class="card"><h3 style="margin-bottom:8px;">Timeline</h3>${timeline}</div>`;
}

async function load() {
  const id = new URLSearchParams(location.search).get('id');
  try {
    const d = await apiGet(`/api/youth/${encodeURIComponent(id)}`);
    document.title = `Coach's Office — ${d.player.name}`;
    content.innerHTML = header(d) + tiles(d)
      + `<div class="grid cols-2">${skillsCard(d)}${outlookCard(d)}</div>`
      + historyCards(d);
  } catch (err) {
    content.innerHTML = `<div class="banner error">${esc(err.message)}</div>`;
  }
}

load();
