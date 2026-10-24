const content = document.getElementById('content');
const pageSub = document.getElementById('pageSub');
const importMsg = document.getElementById('importMsg');
const youthFile = document.getElementById('youthFile');

const SHORT = { keeper: 'GK', defending: 'DEF', playmaking: 'PM', winger: 'WG', passing: 'PS', scoring: 'SC', setpieces: 'SP' };

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function skillCell(s) {
  const cur = s.current ?? '?';
  const max = s.potential ?? '?';
  if (s.current == null && s.potential == null) return '<td class="yskill unknown">·</td>';
  const title = `${s.label}: ${s.currentName ?? 'current unknown'} → ${s.potentialName ?? 'potential unknown'}${s.maxedOut ? ' (maxed out)' : ''}`;
  return `<td class="yskill${s.maxedOut ? ' maxed' : ''}" title="${esc(title)}">${cur}<span class="ymax">/${max}</span></td>`;
}

function promotionCell(p) {
  if (p.promotableNow) return '<span class="chip good">Now</span>';
  if (p.daysUntilPromotion == null) return '—';
  const weeks = Math.ceil(p.daysUntilPromotion / 7);
  return `<span class="${p.daysUntilPromotion <= 28 ? 'chip gold' : 'muted'}">in ${weeks} wk</span>`;
}

function ceilingCell(p) {
  const b = p.bestPotential;
  if (!b) return '<span class="muted">unknown</span>';
  const tone = { high: 'good', medium: 'gold', low: 'serious' }[p.ceiling];
  return `<span class="chip ${tone}" title="${esc(`${b.atLeast ? 'At least ' : ''}${b.name} in ${b.label}`)}">${b.atLeast ? '≥' : ''}${b.level} ${SHORT[b.key]}</span>`;
}

function tiles(data) {
  const s = data.summary;
  return `<div class="grid cols-4">
    <div class="card stat-tile">
      <span class="caption">Players</span>
      <span class="value mono-stat">${s.playerCount}</span>
      <span class="delta flat">${s.avgRevealedPct}% of skill values revealed</span>
    </div>
    <div class="card stat-tile">
      <span class="caption">Promotable now</span>
      <span class="value mono-stat">${s.promotableNow}</span>
      <span class="delta flat">${s.promotableSoon} more within 4 weeks</span>
    </div>
    <div class="card stat-tile">
      <span class="caption">High ceiling</span>
      <span class="value mono-stat">${s.highCeiling}</span>
      <span class="delta flat">potential ${data.thresholds.highCeiling}+ (solid or better)</span>
    </div>
    <div class="card stat-tile">
      <span class="caption">Low ceiling</span>
      <span class="value mono-stat">${s.lowCeiling}</span>
      <span class="delta flat">best known ≤ ${data.thresholds.lowCeiling} (inadequate)</span>
    </div>
  </div>`;
}

function headroomSection(data) {
  const useful = data.trainingHeadroom.filter((t) => t.levels > 0);
  const maxLevels = Math.max(1, ...useful.map((t) => t.levels));
  const body = useful.length
    ? useful.map((t) => `
      <div class="yheadroom">
        <span class="ylabel">${t.label}</span>
        <div class="meter-track"><div class="meter-fill" style="width:${Math.round((t.levels / maxLevels) * 100)}%"></div></div>
        <span class="mono">+${t.levels}</span>
        <span class="muted yplayers">${t.players.map((p) => `${esc(p.name)} ${p.from}→${p.to}`).join(' · ')}</span>
      </div>`).join('')
    : '<p class="muted" style="margin:0;font-size:13px;">No known headroom left for players with a passable-or-better ceiling. Reveal more potentials (matches, scout reports), or the academy is fully trained.</p>';
  return `<div class="card" style="margin-top:16px;">
    <h3 style="margin-bottom:4px;">Where youth training still pays off</h3>
    <p class="muted" style="font-size:12.5px;margin:0 0 12px;">Known levels left to gain per skill (potential minus current), counted only for players whose potential in it is above inadequate. A strong hint for your primary youth training.</p>
    ${body}
  </div>`;
}

function changesSection(data) {
  const items = [];
  for (const p of data.players) {
    const c = p.sinceLastImport;
    if (!c) continue;
    c.levelUps.forEach((u) => items.push(`<li><b>${esc(p.name)}</b>: ${u.skill} ${u.from} → ${u.to}</li>`));
    c.revealed.forEach((r) => items.push(`<li><b>${esc(p.name)}</b>: ${r.skill} ${r.what} revealed (${r.level})</li>`));
  }
  if (!items.length) return '';
  return `<div class="card" style="margin-top:16px;">
    <h3 style="margin-bottom:8px;">Since the previous import</h3>
    <ul style="margin:0;padding-left:20px;font-size:13px;">${items.join('')}</ul>
  </div>`;
}

function tableSection(data) {
  const rows = data.players.map((p) => `<tr>
    <td style="font-family:inherit;">
      <b>${esc(p.name)}</b>${p.specialty ? ` <span class="chip gold">${esc(p.specialty)}</span>` : ''}
      ${p.injuryWeeks > 0 ? ` <span class="chip critical">inj ${p.injuryWeeks}w</span>` : ''}
      <div class="muted" style="font-size:11.5px;">${esc(p.verdict.why)}</div>
    </td>
    <td>${p.age.years}y ${p.age.days}d${p.daysUntilAgeOut <= 28 ? ` <span class="chip warning" title="Turns ${data.thresholds.ageOutYears} in ~${p.daysUntilAgeOut} days">19 soon</span>` : ''}</td>
    <td>${promotionCell(p)}</td>
    <td><span class="pos ${posClass(p.suggestedRole)}">${p.suggestedRole}</span></td>
    <td>${ceilingCell(p)}</td>
    ${p.skills.map(skillCell).join('')}
    <td>${p.revealedPct}%</td>
    <td>${p.lastMatch.rating != null ? `${p.lastMatch.rating}★` : '—'}${p.lastMatch.position ? ` <span class="muted">${esc(p.lastMatch.position)}</span>` : ''}</td>
    <td style="font-family:inherit;"><span class="chip ${p.verdict.tone || ''}">${esc(p.verdict.label)}</span></td>
  </tr>`).join('');

  return `<div class="halfway"></div>
  <div class="page-head" style="margin-bottom:12px;"><h2>Players</h2>
    <span class="muted" style="font-size:12.5px;">Skills shown as current<span class="ymax">/potential</span>; ? = not revealed yet; green = maxed out</span>
  </div>
  <div class="card" style="overflow-x:auto;">
    <table class="wf-table ytable">
      <thead><tr>
        <th>Player</th><th>Age</th><th>Promote</th><th>Role</th><th>Ceiling</th>
        ${Object.values(SHORT).map((s) => `<th>${s}</th>`).join('')}
        <th>Known</th><th>Last match</th><th>Call</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <p class="muted" style="font-size:11.5px;margin-top:10px;">
    Hattrick reveals a youth player's current and potential levels gradually (scout report, coach comments after
    matches, training), so every call here is only as good as what's been revealed; the <b>Known</b> column says how much
    that is. <b>Ceiling</b> is the best revealed potential, or the current level as a lower bound (≥) where the potential
    is still hidden. <b>Role</b> is derived from where the player can end up, not where they last played. Promotion is
    possible from 17 after a minimum stay in the academy (the CSV's own countdown, rolled forward from the import date);
    ages use Hattrick's 112-day year. The "19 soon" flag mirrors community tools such as Hattrick Youthclub.
  </p>`;
}

function render(data) {
  if (!data.hasYouth) {
    pageSub.textContent = 'No youth players imported yet';
    content.innerHTML = `<div class="empty-state"><b>No youth academy data yet</b>
      Export your youth players from Hattrick as CSV (the youthplayers_….csv file) and use <b>Import youth CSV</b> above.
      Re-import every week or so: each import is kept as a snapshot, so level-ups and newly revealed potentials show up here.</div>`;
    return;
  }
  pageSub.textContent = `${data.summary.playerCount} players · as of import ${formatDate(data.asOfDate)}`;
  content.innerHTML = tiles(data) + headroomSection(data) + changesSection(data) + tableSection(data);
}

async function load() {
  try {
    render(await apiGet('/api/youth'));
  } catch (err) {
    content.innerHTML = `<div class="banner error">${esc(err.message)}</div>`;
  }
}

youthFile.addEventListener('change', async () => {
  const file = youthFile.files[0];
  if (!file) return;
  importMsg.innerHTML = '<div class="banner info">Importing…</div>';
  try {
    const result = await uploadYouthCsv(file);
    importMsg.innerHTML = `<div class="banner good">Imported ${result.playerCount} youth players${result.released ? ` · ${result.released} no longer in the academy` : ''}.</div>`;
    await load();
  } catch (err) {
    const rowErrors = err.data?.rowErrors || [];
    importMsg.innerHTML = `<div class="banner error">${[esc(err.message), ...rowErrors.map((e) => `• ${esc(e)}`)].join('<br>')}</div>`;
  } finally {
    youthFile.value = '';
  }
});

load();
