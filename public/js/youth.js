const content = document.getElementById('content');
const pageSub = document.getElementById('pageSub');

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
        <span class="ylabel">${t.label}${t.trainedAs ? ` <span class="chip ${t.trainedAs === 'primary' ? 'good' : 'gold'}">${t.trainedAs}</span>` : ''}</span>
        <div class="meter-track"><div class="meter-fill" style="width:${Math.round((t.levels / maxLevels) * 100)}%"></div></div>
        <span class="mono">+${t.levels}</span>
        <span class="muted yplayers">${t.players.map((p) => `${esc(p.name)} ${p.from}→${p.to}`).join(' · ')}</span>
      </div>`).join('')
    : '<p class="muted" style="margin:0;font-size:13px;">No known headroom left for players with a passable-or-better ceiling. Reveal more potentials (matches, scout reports), or the academy is fully trained.</p>';
  return `<div class="card" style="margin-top:16px;">
    <h3 style="margin-bottom:4px;">Where youth training still pays off</h3>
    <p class="muted" style="font-size:12.5px;margin:0 0 12px;">Known levels left to gain per skill (potential minus current), counted only for players whose potential in it is above inadequate. Skills your academy trains right now are marked primary / secondary.</p>
    ${body}
    ${(data.trainingAdvice || []).length ? `<div class="banner info" style="margin:12px 0 0;">${data.trainingAdvice.map(esc).join('<br>')}</div>` : ''}
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

// Per trained skill: next level and time to the known potential, from the
// self-learning model (services/youthTraining.js). Always a range.
function outlookCell(p) {
  if (!p.outlook.length) return '<span class="muted">—</span>';
  return p.outlook.map((o) => {
    const tag = `${SHORT[o.skillKey]}${o.slot === 'primary' ? '●' : '○'}`;
    if (o.status === 'maxed') return `<div><span class="muted">${tag}</span> maxed</div>`;
    if (o.status !== 'ok') return `<div><span class="muted">${tag}</span> <span class="muted" title="Last match position gets no training from this type">not reached</span></div>`;
    const title = [
      `${o.skill} ${o.current} → ${o.current + 1}: ~${o.weeksPerLevel} weeks per level`,
      o.bankedPct != null ? `~${o.bankedPct}% banked since the last level-up` : 'progress since the last level-up unknown, so the range is wide',
      o.observed ? `observed in this player's own history: ~${o.observed.low}–${o.observed.high} wk` : null,
      ...o.assumptions,
    ].filter(Boolean).join('\n');
    const pot = o.toPotential
      ? ` · max ~${o.toPotential.low}–${o.toPotential.high} wk${{ yes: ' ✓', tight: ' <span class="chip warning">tight</span>', no: ' <span class="chip serious">after 19</span>' }[o.toPotential.beforeAgeOut]}`
      : '';
    return `<div title="${esc(title)}"><span class="muted">${tag}</span> next ~${o.nextLevel.low}–${o.nextLevel.high} wk${pot}</div>`;
  }).join('');
}

function modelSection(data) {
  const c = data.calibration;
  if (!data.training?.primary && !data.training?.secondary) return '';
  const head = '<h3 style="margin-bottom:4px;">Youth training model';
  if (!c || !c.runs) {
    return `<div class="card" style="margin-top:16px;">${head}</h3>
      <p class="muted" style="font-size:12.5px;margin:0;">
        Not calibrated yet: estimates use the senior-squad training formula as a starting point, so treat them as
        rough. The model learns from your own academy as soon as a player levels up <b>twice</b> in a trained skill
        between imports (the first level-up only marks the start). Keep importing weekly, with the training filled in.
      </p></div>`;
  }
  const pct = Math.round((c.factor - 1) * 100);
  const verdict = Math.abs(pct) < 5
    ? 'Your youth players train about as fast as the starting formula predicts.'
    : pct > 0
      ? `Your youth players train about ${pct}% faster than the starting formula predicts; estimates are shortened to match.`
      : `Your youth players train about ${-pct}% slower than the starting formula predicts; estimates are lengthened to match.`;
  const runs = c.recent.map((r) => `<div class="player-row">
      <span>${esc(r.name)} · ${esc(r.skill)} <span class="muted" style="font-size:11.5px;">${r.slot} · ${formatDate(r.from)} → ${formatDate(r.to)}</span></span>
      <span class="right">+${r.levels} seen · ${r.modeled} modeled</span>
    </div>`).join('');
  return `<div class="card" style="margin-top:16px;">
    ${head} <span class="chip ${c.confidence === 'high' ? 'good' : c.confidence === 'medium' ? 'gold' : 'warning'}">${c.confidence} confidence</span></h3>
    <p style="font-size:13px;margin:0 0 6px;"><b>×${c.factor.toFixed(2)}</b>: ${verdict}</p>
    <p class="muted" style="font-size:11.5px;margin:0 0 8px;">
      Learned from ${c.runs} level-up${c.runs === 1 ? '' : 's'} across ${c.players} player${c.players === 1 ? '' : 's'}:
      ${c.levelsObserved} level${c.levelsObserved === 1 ? '' : 's'} actually gained where the model, replayed with the training
      reported at the time, expected ${c.levelsModeled}. Few samples are pulled toward ×1.00.
    </p>
    ${runs}
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
    <td class="youtlook">${outlookCell(p)}</td>
    <td>${p.lastMatch.rating != null ? `${p.lastMatch.rating}★` : '—'}${p.lastMatch.position ? ` <span class="muted">${esc(p.lastMatch.position)}</span>` : ''}</td>
    <td style="font-family:inherit;"><span class="chip ${p.verdict.tone || ''}">${esc(p.verdict.label)}</span></td>
  </tr>`).join('');

  return `<div class="halfway"></div>
  <div class="page-head" style="margin-bottom:12px;"><h2>Players</h2>
    <span class="muted" style="font-size:12.5px;">Skills shown as current<span class="ymax">/potential</span>; ? = not revealed yet; green = maxed out; ● primary / ○ secondary training</span>
  </div>
  <div class="card" style="overflow-x:auto;">
    <table class="wf-table ytable">
      <thead><tr>
        <th>Player</th><th>Age</th><th>Promote</th><th>Role</th><th>Ceiling</th>
        ${Object.entries(SHORT).map(([key, s]) => {
          const as = data.players[0]?.skills.find((x) => x.key === key)?.trained;
          return `<th${as ? ` class="ytrained" title="${as} training"` : ''}>${s}${as ? (as === 'primary' ? ' ●' : ' ○') : ''}</th>`;
        }).join('')}
        <th>Known</th><th>Training outlook</th><th>Last match</th><th>Call</th>
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
    <b>Training outlook</b> covers the skills your academy trains now (● primary, ○ secondary): weeks to the next level
    and to the known potential, from the youth training model above. It uses the last match position for how much
    training a player gets; hover a line for the details and assumptions.
  </p>`;
}

function render(data) {
  if (!data.hasYouth) {
    pageSub.textContent = 'No youth players imported yet';
    content.innerHTML = `<div class="empty-state"><b>No youth academy data yet</b>
      Export your youth players from Hattrick as CSV (the youthplayers_….csv file) and upload it under
      <a href="/settings.html">Settings → Data upload</a>. Re-import every week or so: each import is kept as a
      snapshot, so level-ups and newly revealed potentials show up here.</div>`;
    return;
  }
  const t = data.training;
  pageSub.textContent = `${data.summary.playerCount} players · as of import ${formatDate(data.asOfDate)}`
    + (t && (t.primary || t.secondary)
      ? ` · training ${t.primary?.label ?? '—'} / ${t.secondary?.label ?? '—'}`
      : ' · youth training not reported');
  content.innerHTML = tiles(data) + headroomSection(data) + modelSection(data) + changesSection(data) + tableSection(data);
}

async function load() {
  try {
    render(await apiGet('/api/youth'));
  } catch (err) {
    content.innerHTML = `<div class="banner error">${esc(err.message)}</div>`;
  }
}

load();
