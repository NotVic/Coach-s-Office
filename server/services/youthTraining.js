// Self-learning training model for the youth academy — the youth
// counterpart of schum.js + calibration.js + training.js for the senior squad.
//
// Prior: Schum's weekly-gain formula (services/schum.js), fed with the
// academy's reported training type, the player's age and level, and how
// much training the last match position receives. Youth specifics:
//  - Primary training counts in full, secondary at SECONDARY_FACTOR (~75%,
//    per community guides — Hattrick doesn't publish it).
//  - The youth export carries no trainer level or minutes played. Those are
//    held at fixed defaults; anything constant about this club (trainer,
//    facilities) is exactly what the learned calibration absorbs.
//
// Learning: every run from one observed level-up to the next in a trained
// skill is a measurement — Hattrick says one level was gained, the model
// replayed over the same weeks says some other amount. The pooled ratio is
// the academy's correction factor, pulled toward 1 while samples are few.
// Revelations (a "?" becoming a number) are never counted as level-ups,
// and any unknown in between (training not reported, a skill hidden in one
// of the two snapshots, a level drop) breaks the run.
//
// The integer levels Hattrick shows are the only ground truth; the model
// only fills in between them, and every forward estimate is a range.
const { db } = require('../db');
const schum = require('./schum');
const { estimateTrainingEta } = require('./training');
const { TRAINING_TYPES } = require('../chpp/parse');
const { YOUTH_SKILLS } = require('./importYouthCsv');

const DAYS_PER_YEAR = 112;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SECONDARY_FACTOR = 0.75;
// Held fixed (not in the youth export); the calibration corrects for them.
const DEFAULT_COACH_LEVEL = 7;
// The formula is a senior-squad fit, so the youth prior is weaker: allow a
// wider correction than calibration.js does, and pull harder toward 1.
const PRIOR_LEVELS = 1.5;
const MIN_FACTOR = 0.25;
const MAX_FACTOR = 4;
const MAX_RUN_RATIO = 6;

// Hattrick's granular match positions → the six sectors the reach table uses.
const SECTOR = {
  GK: 'GK', CD: 'CD', LCD: 'CD', RCD: 'CD', CB: 'CD',
  WB: 'WB', LB: 'WB', RB: 'WB', LWB: 'WB', RWB: 'WB',
  WI: 'WI', LW: 'WI', RW: 'WI', LM: 'WI', RM: 'WI',
  IM: 'IM', CM: 'IM', LIM: 'IM', RIM: 'IM',
  FW: 'FW', CF: 'FW', LFW: 'FW', RFW: 'FW', ST: 'FW',
};

function daysBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / MS_PER_DAY;
}

function getYouthTrainingLog() {
  return db.prepare('SELECT * FROM youth_training_log ORDER BY log_date ASC').all();
}

/** The training reported at or before `date` (imports log it per day). */
function youthTrainingOn(log, date) {
  let found = null;
  for (const row of log) {
    if (row.log_date > date) break;
    found = row;
  }
  return found;
}

/** Which slot (if any) trains this youth skill: { slot, typeId } or null. */
function slotFor(training, skillKey) {
  if (!training) return null;
  for (const [slot, typeId] of [['primary', training.primary_type_id], ['secondary', training.secondary_type_id]]) {
    if (typeId != null && TRAINING_TYPES[typeId]?.skillKey === `skill_${skillKey}`) return { slot, typeId };
  }
  return null;
}

/**
 * Modeled fraction of a level gained per week. `calibration` 1 = prior only.
 * Returns { gainPerWeek, positionTier, assumptions } or null.
 */
function youthWeeklyGain({ level, typeId, slot, ageYears, position, calibration = 1 }) {
  const sector = SECTOR[(position || '').toUpperCase()] ?? null;
  const { tier, timeFactor } = schum.positionTimeFactor(typeId, sector);
  const gain = schum.weeklyGain({
    skillLevel: level,
    trainingTypeId: typeId,
    ageYears,
    intensityPct: 100,
    staminaPct: 0,
    coachLevel: DEFAULT_COACH_LEVEL,
    assistantLevels: 0,
    timeFactor: timeFactor ?? 1,
    calibration,
  });
  if (!gain) return null;
  const assumptions = ['youth trainer and minutes played aren\'t in the export (absorbed by calibration)'];
  if (timeFactor == null) assumptions.push('no last-match position: assumes full minutes in a trained position');
  else assumptions.push(`position from last match (${position}: ${tier})`);
  if (slot === 'secondary') assumptions.push(`secondary training at ~${Math.round(SECONDARY_FACTOR * 100)}% of primary (community estimate)`);
  return {
    gainPerWeek: Math.min(1, gain.gainPerWeek * (slot === 'secondary' ? SECONDARY_FACTOR : 1)),
    positionTier: timeFactor == null ? 'unknown' : tier,
    assumptions,
  };
}

function ageYearsOf(snap) {
  if (snap.age_years == null) return null;
  return snap.age_years + (snap.age_days ?? 0) / DAYS_PER_YEAR;
}

/** Modeled progress over one snapshot interval, or null when it can't be modeled. */
function modeledInterval(a, b, skillKey, slot, calibration = 1) {
  const weeks = daysBetween(a.snapshot_date, b.snapshot_date) / 7;
  const gain = youthWeeklyGain({
    level: a[`cur_${skillKey}`], typeId: slot.typeId, slot: slot.slot,
    ageYears: ageYearsOf(a), position: a.last_match_position, calibration,
  });
  return gain && weeks > 0 ? gain.gainPerWeek * weeks : null;
}

/** Complete level-up-to-level-up runs in trained skills, for one youth player. */
function runsForPlayer(player, snapshots, log) {
  const runs = [];
  for (const [skillKey, label] of YOUTH_SKILLS) {
    let run = null;
    for (let i = 0; i < snapshots.length - 1; i++) {
      const a = snapshots[i];
      const b = snapshots[i + 1];
      const ca = a[`cur_${skillKey}`];
      const cb = b[`cur_${skillKey}`];
      // Hidden in either snapshot: nothing is known about this interval.
      if (ca == null || cb == null) { run = null; continue; }
      const delta = cb - ca;
      const slot = slotFor(youthTrainingOn(log, a.snapshot_date), skillKey);
      if (!slot) {
        if (delta !== 0) run = null; // a gain the model can't explain
        continue;
      }
      if (delta < 0) { run = null; continue; }
      if (run) {
        const m = modeledInterval(a, b, skillKey, slot);
        if (m == null) { run = null; continue; }
        run.modeled += m;
        run.slot = run.slot === slot.slot ? run.slot : 'mixed';
      }
      if (delta > 0) {
        if (run && run.modeled > 0) {
          const ratio = delta / run.modeled;
          if (ratio <= MAX_RUN_RATIO && ratio >= 1 / MAX_RUN_RATIO) {
            runs.push({
              playerId: player.youth_player_id, name: player.name, skill: label, slot: run.slot,
              from: run.from, to: b.snapshot_date, levels: delta, modeled: run.modeled,
            });
          }
        }
        run = { from: b.snapshot_date, modeled: 0, slot: slot.slot };
      }
    }
  }
  return runs;
}

function historyByPlayer() {
  const map = new Map();
  for (const s of db.prepare('SELECT * FROM youth_snapshots ORDER BY youth_player_id, snapshot_date ASC').all()) {
    if (!map.has(s.youth_player_id)) map.set(s.youth_player_id, []);
    map.get(s.youth_player_id).push(s);
  }
  return map;
}

/**
 * The academy's learned correction on the prior. Same shape as
 * calibration.js's computeCalibration, plus per-slot level counts.
 */
function computeYouthCalibration(log = getYouthTrainingLog(), history = historyByPlayer()) {
  const empty = { factor: 1, runs: 0, levelsObserved: 0, levelsModeled: 0, players: 0, confidence: 'none', recent: [], bySlot: {} };
  if (!log.length) return empty;
  // Promoted/released players included: their history is just as valid.
  const players = db.prepare('SELECT youth_player_id, name FROM youth_players').all();
  const runs = players.flatMap((p) => runsForPlayer(p, history.get(p.youth_player_id) ?? [], log));
  if (!runs.length) return empty;

  const levelsObserved = runs.reduce((n, r) => n + r.levels, 0);
  const levelsModeled = runs.reduce((n, r) => n + r.modeled, 0);
  const raw = (levelsObserved + PRIOR_LEVELS) / (levelsModeled + PRIOR_LEVELS);
  const factor = Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, raw));
  const bySlot = {};
  for (const r of runs) {
    bySlot[r.slot] ??= { runs: 0, levelsObserved: 0, levelsModeled: 0 };
    bySlot[r.slot].runs += 1;
    bySlot[r.slot].levelsObserved += r.levels;
    bySlot[r.slot].levelsModeled = Math.round((bySlot[r.slot].levelsModeled + r.modeled) * 100) / 100;
  }
  return {
    factor: Math.round(factor * 100) / 100,
    runs: runs.length,
    levelsObserved,
    levelsModeled: Math.round(levelsModeled * 100) / 100,
    players: new Set(runs.map((r) => r.playerId)).size,
    confidence: runs.length >= 8 ? 'high' : runs.length >= 3 ? 'medium' : 'low',
    bySlot,
    recent: runs
      .sort((x, y) => (x.to < y.to ? 1 : -1))
      .slice(0, 8)
      .map((r) => ({ ...r, modeled: Math.round(r.modeled * 100) / 100 })),
  };
}

/**
 * Forward estimate for each skill the academy trains now, for one player.
 * @param {object} p { skills: [{key, current, potential}], ageYears, position, daysUntilPromotion, daysUntilAgeOut }
 * @param {Array} snapshots this player's youth_snapshots, ascending
 * @param {object} training current youth_training_log row
 * @param {number} calibration from computeYouthCalibration
 * @param {string|null} trainingSince first day the current training pair was reported
 */
function predictPlayer(p, snapshots, training, calibration, trainingSince, now = Date.now()) {
  const out = [];
  for (const s of p.skills) {
    const slot = slotFor(training, s.key);
    if (!slot || s.current == null) continue;
    const base = { skillKey: s.key, skill: s.label, slot: slot.slot, current: s.current, potential: s.potential };
    if (s.potential != null && s.current >= s.potential) {
      out.push({ ...base, status: 'maxed' });
      continue;
    }

    const gainAt = (level, weeksAhead = 0) => youthWeeklyGain({
      level, typeId: slot.typeId, slot: slot.slot,
      ageYears: p.ageYears + weeksAhead / 16, position: p.position, calibration,
    });
    const g = gainAt(s.current);
    if (!g || g.gainPerWeek <= 0) {
      out.push({ ...base, status: 'not_reached', positionTier: g?.positionTier ?? 'unknown', assumptions: g?.assumptions ?? [] });
      continue;
    }

    // Progress already banked toward the next level: modeled since the last
    // level-up seen in this skill. Without one, it's unknown (0–100%).
    let banked = null;
    for (let i = snapshots.length - 1; i > 0; i--) {
      const prev = snapshots[i - 1][`cur_${s.key}`];
      const cur = snapshots[i][`cur_${s.key}`];
      if (prev != null && cur != null && cur > prev) {
        banked = Math.min(0.95, g.gainPerWeek * (daysBetween(snapshots[i].snapshot_date, new Date(now).toISOString()) / 7));
        break;
      }
    }
    const weeksPerLevel = 1 / g.gainPerWeek;
    const remaining = banked == null ? null : (1 - banked) * weeksPerLevel;
    const next = remaining == null
      ? { low: 1, high: Math.max(2, Math.round(weeksPerLevel)) }
      : { low: Math.max(1, Math.round(remaining * 0.8)), high: Math.max(2, Math.round(remaining * 1.2)) };

    // Weeks until the known potential, level by level (higher levels and an
    // older player train slower), starting from the banked progress.
    let toPotential = null;
    if (s.potential != null) {
      let weeks = 0;
      for (let level = s.current; level < s.potential; level++) {
        const gl = gainAt(level, weeks);
        if (!gl || gl.gainPerWeek <= 0) { weeks = null; break; }
        weeks += (level === s.current && banked != null ? 1 - banked : 1) / gl.gainPerWeek;
      }
      if (weeks != null) {
        const ageOutWeeks = p.daysUntilAgeOut / 7;
        toPotential = {
          low: Math.max(1, Math.round(weeks * 0.8)),
          high: Math.max(2, Math.round(weeks * 1.2)),
          // Compared at the optimistic and pessimistic ends of the range.
          beforeAgeOut: weeks * 1.2 <= ageOutWeeks ? 'yes' : weeks * 0.8 > ageOutWeeks ? 'no' : 'tight',
        };
      }
    }

    // The independent observed estimate (same estimator as the senior
    // squad), from this player's own level-ups under the current training.
    const points = snapshots
      .filter((x) => x[`cur_${s.key}`] != null)
      .map((x) => ({ snapshot_date: x.snapshot_date, level: x[`cur_${s.key}`] }));
    const observed = estimateTrainingEta(points, 'level', { isTrained: true, sinceDate: trainingSince, ageYears: p.ageYears });

    out.push({
      ...base,
      status: 'ok',
      gainPerWeek: Math.round(g.gainPerWeek * 1000) / 1000,
      weeksPerLevel: Math.round(weeksPerLevel * 10) / 10,
      bankedPct: banked == null ? null : Math.round(banked * 100),
      nextLevel: next,
      toPotential,
      observed: observed.status === 'training' ? { low: observed.low, high: observed.high, weeksPerLevel: observed.weeksPerLevel } : null,
      positionTier: g.positionTier,
      assumptions: g.assumptions,
    });
  }
  return out;
}

module.exports = { computeYouthCalibration, predictPlayer, getYouthTrainingLog, historyByPlayer, SECONDARY_FACTOR };
