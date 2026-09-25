// The Training page's data: the club's current training setup, who that
// training actually reaches, and every player ranked by how close they are
// to the next level in the trained skill.
//
// This is where the Schum model (services/schum.js) and the observed-history
// estimate (services/training.js) are shown side by side per player — a
// disagreement between the two is itself a signal, so neither is hidden
// behind the other.
const { db, getSetting } = require('../db');
const schum = require('./schum');
const { getSubskill } = require('./subskills');
const { estimateTrainingEta } = require('./training');
const { skillLevelName } = require('../chpp/parse');

const SKILL_LABELS = {
  skill_keeper: 'Keeper', skill_defending: 'Defending', skill_playmaking: 'Playmaking',
  skill_winger: 'Winger', skill_passing: 'Passing', skill_scoring: 'Scoring',
  skill_setpieces: 'Set pieces', skill_stamina: 'Stamina',
};

// "Close enough to plan around" — roughly a sixth of a Hattrick season.
const SOON_WEEKS = 6;

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/** The club-wide training settings, however they got here (CHPP sync or CSV import). */
function readFocus() {
  const skillKey = getSetting('training_focus_skill');
  if (!skillKey) return null;
  const coachGlobal = numOrNull(getSetting('coach_skill_level'));
  return {
    skillKey,
    skillLabel: SKILL_LABELS[skillKey] ?? skillKey,
    typeId: numOrNull(getSetting('training_focus_type_id')),
    typeLabel: getSetting('training_focus_type_label'),
    intensityPct: numOrNull(getSetting('training_focus_intensity_pct')),
    staminaPct: numOrNull(getSetting('training_focus_stamina_pct')),
    coachName: getSetting('coach_name'),
    coachSkillLevel: coachGlobal,
    // Hattrick's own club page shows staff skill out of 5; the model is
    // keyed on the global 4-8 scale. Both are surfaced so the page can show
    // what the manager actually sees in the game.
    coachLevel5: coachGlobal != null && coachGlobal >= 4 && coachGlobal <= 8 ? coachGlobal - 3 : null,
    coachSkillName: getSetting('coach_skill_name') ?? (coachGlobal != null ? skillLevelName(coachGlobal) : null),
    assistantLevels: numOrNull(getSetting('assistant_levels')),
    source: getSetting('training_focus_source'),
    setAt: getSetting('training_focus_set_at'),
  };
}

function rankOf(row) {
  if (row.status === 'training') return 0;
  if (row.status === 'decay_exceeds_gain') return 1;
  if (row.status === 'not_trained_here') return 2;
  return 3;
}

/**
 * @param {{assumeFullMinutes?: boolean}} opts assumeFullMinutes ignores each
 *   player's own position and asks "what if I field them where this training
 *   lands?" — the planning view. The default is the realistic one: each
 *   player gets whatever share of the training their own position earns.
 */
function buildTrainingBoard({ assumeFullMinutes = false } = {}) {
  const teamId = numOrNull(getSetting('chpp_team_id'));
  const focus = readFocus();

  if (!teamId) return { hasSquad: false, hasFocus: Boolean(focus) };
  if (!focus) return { hasSquad: true, hasFocus: false };

  const players = db.prepare(
    'SELECT * FROM players WHERE team_id = ? AND is_active = 1'
  ).all(teamId);

  // One query for every snapshot, grouped in JS — the observed estimate
  // needs each player's full history, and a per-player query would be N+1.
  const snapshots = db.prepare(
    `SELECT ps.* FROM player_snapshots ps
     JOIN players p ON p.player_id = ps.player_id
     WHERE p.team_id = ? AND p.is_active = 1
     ORDER BY ps.player_id, ps.snapshot_date ASC`
  ).all(teamId);
  const historyOf = new Map();
  for (const s of snapshots) {
    if (!historyOf.has(s.player_id)) historyOf.set(s.player_id, []);
    historyOf.get(s.player_id).push(s);
  }

  const reach = focus.typeId != null ? schum.trainingReach(focus.typeId) : null;

  const rows = players.map((p) => {
    const level = p[focus.skillKey];
    const posFit = focus.typeId != null
      ? schum.positionTimeFactor(focus.typeId, p.position_code)
      : { tier: 'unknown', timeFactor: null };
    const timeFactor = assumeFullMinutes ? 1 : posFit.timeFactor;

    // Banked progress only counts while it's still anchored to the level the
    // player is actually on (a confirmed level change resets it).
    const sub = getSubskill(p.player_id, focus.skillKey);
    const subProgress = sub && sub.anchored_level === level ? Math.max(0, sub.sub_value) : 0;

    let modeled = null;
    if (focus.typeId != null && timeFactor != null && timeFactor > 0) {
      modeled = schum.modeledEta({
        skillLevel: level,
        subProgress,
        trainingTypeId: focus.typeId,
        ageYears: p.age_years,
        intensityPct: focus.intensityPct,
        staminaPct: focus.staminaPct,
        coachLevel: focus.coachSkillLevel,
        assistantLevels: focus.assistantLevels,
        skillKey: focus.skillKey,
        timeFactor,
      });
    }

    const observed = estimateTrainingEta(historyOf.get(p.player_id) ?? [], focus.skillKey, {
      isTrained: true,
      sinceDate: focus.setAt,
      ageYears: p.age_years,
    });

    let status;
    if (timeFactor === 0) status = 'not_trained_here';
    else if (modeled?.status === 'ok') status = 'training';
    else if (modeled?.status === 'decay_exceeds_gain') status = 'decay_exceeds_gain';
    else status = 'unknown';

    return {
      playerId: p.player_id,
      name: `${p.first_name} ${p.last_name}`.trim(),
      positionCode: p.position_code,
      ageYears: p.age_years,
      injuryWeeks: p.injury_weeks,
      level,
      levelName: skillLevelName(level),
      tier: posFit.tier,
      // What their own position earns (what `tier` means) vs what this view
      // actually applied — these differ in the "fielded to train" view, and
      // conflating them made the badge read "Trickle only - 100%".
      timeFactorPct: posFit.timeFactor != null ? Math.round(posFit.timeFactor * 100) : null,
      appliedTimeFactorPct: timeFactor != null ? Math.round(timeFactor * 100) : null,
      progressPct: Math.round(subProgress * 100),
      status,
      weeksLow: modeled?.low ?? null,
      weeksHigh: modeled?.high ?? null,
      weeksPerLevel: modeled?.weeksPerLevel ?? null,
      gainPerWeek: modeled?.gainPerWeek ?? null,
      dropPerWeek: modeled?.dropPerWeek ?? null,
      assumptions: modeled?.assumptions ?? [],
      observed,
      levelUpSoon: modeled?.status === 'ok' && modeled.low <= SOON_WEEKS,
    };
  });

  rows.sort((a, b) => {
    const byStatus = rankOf(a) - rankOf(b);
    if (byStatus !== 0) return byStatus;
    if (a.status === 'training' && b.status === 'training') {
      return (a.weeksLow - b.weeksLow) || (a.weeksHigh - b.weeksHigh) || (b.progressPct - a.progressPct);
    }
    return (b.level ?? 0) - (a.level ?? 0);
  });

  // How much of the squad each reach tier covers, for the "who does this
  // training actually reach?" card.
  const squadByTier = { full: 0, partly: 0, osmosis: 0, none: 0, unknown: 0 };
  for (const r of rows) squadByTier[r.tier] = (squadByTier[r.tier] ?? 0) + 1;

  return {
    hasSquad: true,
    hasFocus: true,
    assumeFullMinutes,
    soonWeeks: SOON_WEEKS,
    focus,
    reach,
    squadByTier,
    summary: {
      trainingCount: rows.filter((r) => r.status === 'training').length,
      soonCount: rows.filter((r) => r.levelUpSoon).length,
      notTrainedCount: rows.filter((r) => r.status === 'not_trained_here').length,
      squadSize: rows.length,
    },
    players: rows,
  };
}

module.exports = { buildTrainingBoard, SKILL_LABELS, SOON_WEEKS };
