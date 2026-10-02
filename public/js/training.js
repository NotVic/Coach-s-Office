const content = document.getElementById('content');
const pageSub = document.getElementById('pageSub');

// 'own' = each player gets their own position's share of the training
// (realistic); 'full' = the planning question, "what if I field them where
// this training actually lands?"
let minutesMode = 'own';

const TIER_LABEL = {
  full: 'Full training',
  partly: 'Half training',
  osmosis: 'Trickle only',
  none: 'Not trained here',
  unknown: 'Unknown',
};
const TIER_CHIP = { full: 'good', partly: 'gold', osmosis: 'warning', none: 'critical', unknown: 'warning' };

function tierChip(row) {
  // Always the player's own position's share — in the "fielded to train"
  // view the estimate is overridden, but the badge still says what they'd
  // actually get where they normally play.
  const pct = row.timeFactorPct != null ? ` · ${row.timeFactorPct}%` : '';
  return `<span class="chip ${TIER_CHIP[row.tier] || 'warning'}">${TIER_LABEL[row.tier] || row.tier}${pct}</span>`;
}

function posPills(codes) {
  if (!codes || !codes.length) return '<span class="muted" style="font-size:12px;">none</span>';
  return codes.map((c) => `<span class="pos ${posClass(c)}" style="margin-right:4px;">${c}</span>`).join('');
}

function modeledCell(row) {
  if (row.status === 'training') {
    return `<b>~${row.weeksLow}–${row.weeksHigh} wk</b>`;
  }
  if (row.status === 'not_trained_here') {
    return '<span class="muted">—</span>';
  }
  if (row.status === 'decay_exceeds_gain') {
    return `<span style="color:var(--sb-status-critical-text);">decay wins</span>`;
  }
  return '<span class="muted">—</span>';
}

function observedCell(observed) {
  if (!observed) return '<span class="muted">—</span>';
  switch (observed.status) {
    case 'training': return `~${observed.low}–${observed.high} wk`;
    case 'declining': return `<span style="color:var(--sb-status-critical-text);">declining</span>`;
    case 'stalled': return '<span class="muted">no level-up yet</span>';
    case 'building_history': return '<span class="muted">building…</span>';
    default: return '<span class="muted">—</span>';
  }
}

function setupSection(data) {
  const f = data.focus;
  const typeName = f.typeLabel || f.skillLabel;
  const staff = [];
  if (f.coachLevel5 != null) staff.push(`Coach ${f.coachLevel5}/5${f.coachSkillName ? ` (${f.coachSkillName})` : ''}`);
  else if (f.coachSkillLevel != null) staff.push(`Coach ${f.coachSkillLevel}`);
  if (f.assistantLevels != null) staff.push(`Assistants ${f.assistantLevels}/10`);

  return `<div class="grid cols-4">
    <div class="card stat-tile">
      <span class="caption">Training type</span>
      <span class="value" style="font-size:18px;">${typeName}</span>
      <span class="delta flat">${f.typeLabel && f.typeLabel !== f.skillLabel ? `primarily ${f.skillLabel}` : 'primary skill'}</span>
    </div>
    <div class="card stat-tile">
      <span class="caption">Intensity</span>
      <span class="value mono-stat">${f.intensityPct != null ? `${f.intensityPct}%` : '—'}</span>
      <span class="delta flat">${f.intensityPct == null ? 'assumed 100%' : 'of full effort'}</span>
    </div>
    <div class="card stat-tile">
      <span class="caption">Stamina share</span>
      <span class="value mono-stat">${f.staminaPct != null ? `${f.staminaPct}%` : '—'}</span>
      <span class="delta flat">${f.staminaPct == null ? 'assumed 10%' : 'not spent on the skill'}</span>
    </div>
    <div class="card stat-tile">
      <span class="caption">Staff</span>
      <span class="value" style="font-size:16px;">${staff.length ? staff[0] : '—'}</span>
      <span class="delta flat">${staff[1] || (f.coachLevel5 == null ? 'coach assumed Solid' : 'no assistants set')}</span>
    </div>
  </div>`;
}

function reachSection(data) {
  const r = data.reach;
  if (!r) {
    return `<div class="card"><h3 style="margin-bottom:6px;">Who this training reaches</h3>
      <p class="muted" style="font-size:13px;margin:0;">Unavailable — the exact Hattrick training type isn't known, only the skill.
      Set it on the <a href="/settings.html">Settings</a> page to see which positions this training actually reaches.</p></div>`;
  }
  const n = data.squadByTier;
  const row = (label, codes, count, note) => `
    <div class="player-row">
      <span style="min-width:110px;"><b style="font-size:13px;">${label}</b></span>
      <span style="flex:1;">${posPills(codes)}</span>
      <span class="right muted">${count} in squad${note ? ` · ${note}` : ''}</span>
    </div>`;

  return `<div class="card">
    <h3 style="margin-bottom:4px;">Who this training reaches</h3>
    <p class="muted" style="font-size:12px;margin:0 0 8px;">
      A training type only trains players fielded in certain positions, and not equally — this is the single
      biggest factor in who actually levels up. Positions below are each player's natural position as derived
      from their skills, not a lineup you've set.
    </p>
    ${row('Full', r.full, n.full)}
    ${r.partly.length ? row('Half', r.partly, n.partly, '50% of the training') : ''}
    ${r.osmosis.length ? row('Trickle', r.osmosis, n.osmosis, `~${Math.round(r.osmosisKoeff * 100)}% of the training`) : ''}
    ${r.none.length ? row('None', r.none, n.none, 'gains nothing') : ''}
  </div>`;
}

function progressTitle(p) {
  return p.bankedPct > p.progressPct
    ? `Model banked ~${p.bankedPct}%, capped to ~${p.progressPct}% by the weeks actually tracked at this level in this position.`
    : 'Modeled progress toward the next level, checked against the tracked history.';
}

function soonSection(data) {
  const soon = data.players.filter((p) => p.levelUpSoon);
  if (!soon.length) {
    return `<div class="card">
      <h3 style="margin-bottom:6px;">Closest to a level-up</h3>
      <p class="muted" style="font-size:13px;margin:0;">
        Nobody in a full- or half-trained position is modeled to level up within ${data.soonWeeks} weeks.
        ${minutesMode === 'own' ? 'Try "If fielded to train" above to see whether full minutes there would get someone over the line.' : ''}
      </p>
    </div>`;
  }
  const cards = soon.slice(0, 6).map((p) => `
    <a class="player-card" href="/player.html?id=${p.playerId}">
      <div class="top">
        <div class="avatar">${initials(p.name)}</div>
        <div>
          <div class="name">${p.name}</div>
          <div class="meta"><span class="pos ${posClass(p.positionCode)}">${p.positionCode}</span> · Age ${p.ageYears ?? '—'}</div>
        </div>
      </div>
      <div class="flags">${tierChip(p)}</div>
      <div style="font-size:12px;color:var(--sb-text-secondary);">
        ${p.levelName ?? '—'} (${p.level ?? '—'}) → ${(p.level ?? 0) + 1}
      </div>
      <div class="meter-track"><div class="meter-fill" style="width:${Math.min(100, p.progressPct)}%"></div></div>
      <div class="stats-row">
        <div>Est. to next level<br><b>~${p.weeksLow}–${p.weeksHigh} wk</b></div>
        <div title="${progressTitle(p)}">Progress<br><b>~${p.progressPct}%</b></div>
      </div>
    </a>`).join('');

  return `<div class="page-head" style="margin-bottom:12px;">
      <h2>Closest to a level-up</h2>
      <span class="muted" style="font-size:12.5px;">${soon.length} within ${data.soonWeeks} weeks</span>
    </div>
    <div class="squad-grid">${cards}</div>`;
}

function boardSection(data) {
  const rows = data.players.map((p) => `
    <tr>
      <td style="font-family:var(--sb-font-body);">
        <a href="/player.html?id=${p.playerId}" style="color:inherit;text-decoration:none;font-weight:600;">${p.name}</a>
        ${p.injuryWeeks > 0 ? ` <span class="chip critical">inj ~${p.injuryWeeks}w</span>` : ''}
      </td>
      <td><span class="pos ${posClass(p.positionCode)}">${p.positionCode}</span></td>
      <td>${p.ageYears ?? '—'}</td>
      <td>${p.levelName ?? '—'} (${p.level ?? '—'})</td>
      <td style="font-family:var(--sb-font-body);">${tierChip(p)}</td>
      <td>${p.status === 'training' ? `<span title="${progressTitle(p)}">~${p.progressPct}%</span>` : '<span class="muted">—</span>'}</td>
      <td>${modeledCell(p)}</td>
      <td>${observedCell(p.observed)}</td>
    </tr>`).join('');

  return `<div class="halfway"></div>
  <div class="page-head" style="margin-bottom:12px;">
    <h2>Full training board</h2>
    <span class="muted" style="font-size:12.5px;">${data.summary.trainingCount} of ${data.summary.squadSize} gaining${data.summary.notTrainedCount ? ` · ${data.summary.notTrainedCount} not trained in their position` : ''}</span>
  </div>
  <div class="card" style="overflow-x:auto;">
    <table class="wf-table">
      <thead><tr>
        <th>Player</th><th>Pos</th><th>Age</th><th>${data.focus.skillLabel}</th>
        <th>Training reach</th><th>Progress</th><th>Est. next level</th><th>Observed</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <p class="muted" style="font-size:11.5px;margin-top:10px;">
    <b>Est. next level</b> is the community Schum formula (see Settings → About the estimates): it multiplies the
    training type, your intensity and stamina split, coach and assistants, the player's age and current level, and
    how much of the training their position actually gets — then corrected by the club's own calibration (bottom of
    this page). <b>Observed</b> is the independent estimate from this
    app's own tracked history for that player — when the two disagree, something in the assumptions is probably
    off (minutes played is the usual suspect). Both are estimates, never promises.
  </p>`;
}

function calibrationSection(data) {
  const c = data.calibration;
  if (!c || !c.runs) {
    return `<div class="card">
      <h3 style="margin-bottom:6px;">Model calibration</h3>
      <p class="muted" style="font-size:12.5px;margin:0;">
        Not calibrated yet — the estimates use the formula as published. Calibration needs a player to level up
        <b>twice</b> in a trained skill while this app is tracking (the first level-up only marks the start), so
        keep importing or syncing weekly and it will pick up on its own.
      </p>
    </div>`;
  }
  const pct = Math.round((c.factor - 1) * 100);
  const verdict = Math.abs(pct) < 5
    ? 'Your players train about as fast as the formula predicts.'
    : pct > 0
      ? `Your players train about ${pct}% faster than the formula predicts, so estimates are shortened to match.`
      : `Your players train about ${-pct}% slower than the formula predicts, so estimates are lengthened to match.`;
  const runs = c.recent.map((r) => `<div class="player-row">
      <span><a href="/player.html?id=${r.playerId}" style="color:inherit;">${r.name}</a>
        <span class="muted" style="font-size:11.5px;">${formatDate(r.from)} → ${formatDate(r.to)}</span></span>
      <span class="right">+${r.levels} seen · ${r.modeled} modeled</span>
    </div>`).join('');
  return `<div class="card">
    <h3 style="margin-bottom:4px;">Model calibration <span class="chip ${c.confidence === 'high' ? 'good' : c.confidence === 'medium' ? 'gold' : 'warning'}">${c.confidence} confidence</span></h3>
    <p style="font-size:13px;margin:0 0 6px;"><b>×${c.factor.toFixed(2)}</b> — ${verdict}</p>
    <p class="muted" style="font-size:11.5px;margin:0 0 8px;">
      From ${c.runs} level-up${c.runs === 1 ? '' : 's'} across ${c.players} player${c.players === 1 ? '' : 's'}:
      ${c.levelsObserved} level${c.levelsObserved === 1 ? '' : 's'} actually gained where the formula, replayed with the
      training logged at the time, expected ${c.levelsModeled}. Few samples are pulled toward ×1.00.
    </p>
    ${runs}
  </div>`;
}

function historySection(data) {
  const periods = data.trainingHistory || [];
  if (!periods.length) {
    return `<div class="card"><h3 style="margin-bottom:6px;">Training history</h3>
      <p class="muted" style="font-size:12.5px;margin:0;">Nothing logged yet — every sync or import from now on records what was trained.</p></div>`;
  }
  const rows = periods.map((t) => {
    const name = t.typeId != null ? (t.typeLabel || t.skillLabel || `Type ${t.typeId}`) : '<span class="muted">Not reported</span>';
    const settings = t.typeId != null ? [
      t.intensityPct != null ? `${t.intensityPct}% int.` : null,
      t.staminaPct != null ? `${t.staminaPct}% stam.` : null,
      t.coachLevel5 != null ? `coach ${t.coachLevel5}/5` : null,
    ].filter(Boolean).join(' · ') + (t.settingsVaried ? ' (varied)' : '') : '';
    const span = `${formatDate(t.from)} → ${t.until ? formatDate(t.until) : 'now'}`;
    return `<div class="player-row">
      <span><b>${name}</b> <span class="muted" style="font-size:11.5px;">${settings}</span></span>
      <span class="right" style="font-size:12px;">${span}</span>
    </div>`;
  }).join('');
  return `<div class="card">
    <h3 style="margin-bottom:4px;">Training history</h3>
    <p class="muted" style="font-size:11.5px;margin:0 0 8px;">What was trained when, as recorded at each sync or import — the calibration replays these.</p>
    ${rows}
  </div>`;
}

function minutesToggle(data) {
  return `<div class="filter-row" style="margin:16px 0 4px;">
    <div class="seg" id="minutesToggle">
      <button data-minutes="own" class="${minutesMode === 'own' ? 'active' : ''}">Their position</button>
      <button data-minutes="full" class="${minutesMode === 'full' ? 'active' : ''}">If fielded to train</button>
    </div>
    <span class="muted" style="font-size:12px;">
      ${minutesMode === 'own'
        ? 'Each player gets whatever share of the training their own position earns.'
        : 'Best case: assumes every player is fielded where this training lands, for a full 90 minutes.'}
    </span>
  </div>`;
}

function render(data) {
  if (!data.hasSquad) {
    content.innerHTML = `<div class="empty-state"><b>No squad yet</b>
      Import your players first, then this page can rank them. <a href="/settings.html">Go to Settings →</a></div>`;
    pageSub.textContent = 'No squad loaded';
    return;
  }
  if (!data.hasFocus) {
    content.innerHTML = `<div class="empty-state"><b>No training focus set</b>
      Tell Coach's Office what your club is training — it comes from CHPP automatically once connected, or from the
      "Training focus" section of the CSV import. <a href="/settings.html">Go to Settings →</a></div>`;
    pageSub.textContent = 'Training focus unknown';
    return;
  }

  const f = data.focus;
  pageSub.textContent = `${f.typeLabel || f.skillLabel}`
    + (f.intensityPct != null ? ` · ${f.intensityPct}% intensity` : '')
    + (f.staminaPct != null ? ` · ${f.staminaPct}% stamina` : '')
    + (f.source === 'chpp' ? ' · synced from Hattrick' : f.setAt ? ` · as reported ${formatDate(f.setAt)}` : '');

  content.innerHTML = setupSection(data)
    + minutesToggle(data)
    + (data.assumeFullMinutes
      ? '<div class="banner info" style="margin:10px 0;font-size:12.5px;">Showing the best case — every player treated as if fielded in a position this training fully reaches. Their natural positions are in the table below.</div>'
      : '')
    + `<div class="grid cols-2" style="margin-top:12px;">${reachSection(data)}
        <div class="card">
          <h3 style="margin-bottom:6px;">This week at a glance</h3>
          <div class="player-row"><span>Gaining in ${f.skillLabel}</span><span class="right"><b>${data.summary.trainingCount}</b> / ${data.summary.squadSize}</span></div>
          <div class="player-row"><span>Level-up within ${data.soonWeeks} weeks</span><span class="right"><b>${data.summary.soonCount}</b></span></div>
          <div class="player-row"><span>Gaining nothing in their position</span><span class="right"><b>${data.summary.notTrainedCount}</b></span></div>
          ${f.coachLevel5 == null || f.assistantLevels == null ? `<p class="muted" style="font-size:11.5px;margin:8px 0 0;">
            Coach and assistant levels are missing, so the estimates fall back to conservative assumptions —
            add them in <a href="/settings.html">Settings</a> for sharper numbers.</p>` : ''}
        </div>
      </div>
    <div class="halfway"></div>`
    + soonSection(data)
    + boardSection(data)
    + `<div class="grid cols-2" style="margin-top:16px;">${calibrationSection(data)}${historySection(data)}</div>`;

  document.getElementById('minutesToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-minutes]');
    if (!btn || btn.dataset.minutes === minutesMode) return;
    minutesMode = btn.dataset.minutes;
    load();
  });
}

async function load() {
  try {
    const data = await apiGet(`/api/training${minutesMode === 'full' ? '?minutes=full' : ''}`);
    render(data);
  } catch (err) {
    content.innerHTML = `<div class="banner error">${err.message}</div>`;
    pageSub.textContent = '';
  }
}

load();
