const content = document.getElementById('content');
const playerId = new URLSearchParams(location.search).get('id');

// Meters show level on a 0–20 scale (Hattrick skills realistically top out
// well under that) — a coarse, relative indicator, not sub-level progress,
// since CHPP doesn't expose fractional progress toward the next level.
const METER_SCALE_MAX = 20;

function etaText(eta) {
  if (!eta) return '';
  if (eta.status === 'no_history') return `<span class="eta">${eta.message}</span>`;
  if (eta.status === 'stalled') return `<span class="eta">${eta.message}</span>`;
  return `<span class="eta">~${eta.low}–${eta.high} weeks to next level (est.)</span>`;
}

function skillMeterHtml(skill, isTrained) {
  const pct = Math.min(100, ((skill.level ?? 0) / METER_SCALE_MAX) * 100);
  return `<div class="skill-meter${isTrained ? ' trained' : ''}">
    <div class="row">
      <span class="label">${skill.label}${isTrained ? ' <span class="chip gold" style="margin-left:6px;">Training</span>' : ''}</span>
      <span class="level">${skill.levelName ?? '—'} (${skill.level ?? '—'})</span>
    </div>
    <div class="meter-track"><div class="meter-fill" style="width:${pct}%"></div></div>
    ${etaText(skill.eta)}
  </div>`;
}

function sidebarHtml(p) {
  const flags = [];
  if (p.injuryWeeks > 0) flags.push(`<span class="chip critical">● Injured, ~${p.injuryWeeks}w</span>`);
  if (p.transferListed) flags.push(`<span class="chip gold">★ Transfer listed</span>`);
  if (p.specialty) flags.push(`<span class="chip good">${p.specialty}</span>`);

  return `<div class="card" style="display:flex;flex-direction:column;gap:14px;">
    <div style="display:flex;gap:12px;align-items:center;">
      <div class="avatar lg">${initials(p.name)}</div>
      <div>
        <h2 style="margin-bottom:2px;">${p.name}</h2>
        <div class="meta muted"><span class="pos ${posClass(p.positionCode)}">${p.positionCode}</span> · Age ${p.ageYears ?? '—'}</div>
      </div>
    </div>
    <div class="flags" style="display:flex;gap:5px;flex-wrap:wrap;">${flags.join('')}</div>
    <div class="halfway" style="margin:2px 0;"></div>
    <div class="stat-tile"><span class="caption">TSI</span><span class="value mono-stat">${formatNumber(p.tsi)}</span></div>
    <div class="stat-tile">
      <span class="caption">Estimated value</span>
      <span class="value mono-stat">~${formatNumber(p.valueRange?.mid)}</span>
      <span class="muted" style="font-size:12px;">range ~${formatNumber(p.valueRange?.low)} – ${formatNumber(p.valueRange?.high)}</span>
    </div>
    <div class="stat-tile">
      <span class="caption">Salary / week</span>
      <span class="value mono-stat">${formatNumber(p.salary)}</span>
      ${p.salaryShareOfWeeklyIncome != null ? `<span class="muted" style="font-size:12px;">~${p.salaryShareOfWeeklyIncome}% of your team's weekly income</span>` : ''}
    </div>
    <div class="stat-tile"><span class="caption">Form</span><span class="value mono-stat">${p.form ?? '—'}</span></div>
  </div>`;
}

function historyChartCard(title, points, color, valueFormat) {
  return `<div class="card chart-card">
    <div class="card-head"><h3>${title}</h3></div>
    <div class="plot">${Charts.lineChart(points, { color, valueFormat })}</div>
  </div>`;
}

function shortLabel(dateStr) {
  return (dateStr || '').slice(0, 10).slice(5) || '?';
}

function ratingChartCard(ratingHistory) {
  if (ratingHistory.length < 2) {
    return `<div class="card chart-card">
      <div class="card-head"><h3>Recent match ratings</h3></div>
      <div class="empty-state">Not enough tracked history yet — this fills in as your team plays more matches between syncs.</div>
    </div>`;
  }
  const bars = ratingHistory.map((h) => ({ label: shortLabel(h.date), value: h.rating }));
  return `<div class="card chart-card">
    <div class="card-head"><h3>Recent match ratings</h3><span class="muted" style="font-size:12px;">sampled each sync, not every match</span></div>
    <div class="plot">${Charts.barChart(bars, { color: 'var(--sb-accent)' })}</div>
  </div>`;
}

function trainingFocusBanner(trainingFocus) {
  if (!trainingFocus) return '';
  const parts = [];
  if (trainingFocus.intensityPct != null) parts.push(`${trainingFocus.intensityPct}% intensity`);
  if (trainingFocus.staminaPct != null) parts.push(`${trainingFocus.staminaPct}% to stamina`);
  return `<div class="banner info" style="margin:0 0 10px;font-size:12px;">
    Training <b>${trainingFocus.label}</b>${parts.length ? ` — ${parts.join(', ')}` : ''}, as you reported on ${formatDate(trainingFocus.setAt)}.
    This is what you told us at your last import, not something Coach's Office fetched — update it next time your training focus changes in Hattrick.
  </div>`;
}

function render(data) {
  const { player, skills, trainedSkillKey, trainingFocus, tsiHistory, valueHistory, ratingHistory } = data;

  content.innerHTML = `<div class="grid cols-12">
    <div class="span-4">${sidebarHtml(player)}</div>
    <div class="span-8" style="display:flex;flex-direction:column;gap:16px;">
      <div class="card">
        <h3 style="margin-bottom:4px;">Skills</h3>
        <p class="muted" style="font-size:12px;margin:0 0 4px;">
          ETA is estimated from this app's own tracked history for this player — not Hattrick's internal formula (see Settings for why).
        </p>
        ${trainingFocusBanner(trainingFocus)}
        ${skills.map((s) => skillMeterHtml(s, s.key === trainedSkillKey)).join('')}
      </div>
      <div class="grid cols-2">
        ${historyChartCard('TSI history', tsiHistory.map((h) => ({ label: shortLabel(h.date), value: h.tsi })), 'var(--sb-accent)')}
        ${historyChartCard('Value history (est.)', valueHistory.map((h) => ({ label: shortLabel(h.date), value: h.value })), 'var(--sb-accent-gold)')}
      </div>
      ${ratingChartCard(ratingHistory)}
    </div>
  </div>`;
}

async function load() {
  if (!playerId) {
    content.innerHTML = `<div class="banner error">No player id in the URL.</div>`;
    return;
  }
  try {
    const data = await apiGet(`/api/players/${playerId}`);
    document.title = `Coach's Office — ${data.player.name}`;
    render(data);
  } catch (err) {
    content.innerHTML = `<div class="banner error">${err.message}</div>`;
  }
}

load();
