// Self-learning training model for the youth academy — the youth
// counterpart of schum.js + calibration.js + training.js for the senior squad.
//
// Youth training is its own system in Hattrick: its own menu (focused,
// extended, combined, and the youth-only "Individual" training), its own
// pace, and primary + secondary training at once. The prior below follows
// Hattrick Organizer's youth model (module/youth/YouthTraining.java and
// WeeklyTrainingType.getFullYouthTrainingPerMinute, LGPL; re-implemented
// here, not ported), itself a community approximation:
//
//   weeks per level (90 full minutes) =
//     (0.5 + 0.1 × level) × (1 + 0.14 × (age − 15)) × D(type)
//
// where D(type) is the senior formula's weeks from level 7 to 8 at age 17
// with a solid coach and full staff — so each training type keeps its own
// relative speed. Position reach (full / partly / osmosis) is the same per
// type as for the senior squad. Secondary training counts 2/3, halved again
// when it repeats the primary type. Individual training spreads over the
// skills that fit the player's position, with fixed odds per sector.
//
// The youth export has no minutes played or match types, so 90 league
// minutes in the last match position are assumed. Anything constant about
// this club is what the learned calibration absorbs: every run from one
// observed level-up to the next in a trained skill is a measurement, and
// the pooled ratio (pulled toward 1 while samples are few) corrects all
// forward estimates. Revelations (a "?" becoming a number) never count as
// level-ups; a hidden value or unreported training breaks a run.
const { db } = require('../db');
const schum = require('./schum');
const { estimateTrainingEta } = require('./training');
const { YOUTH_SKILLS } = require('./importYouthCsv');

const SKILL_LABEL = Object.fromEntries(YOUTH_SKILLS);

// Hattrick's youth training menu. Ids are the shared Hattrick training-type
// ids (also what HO stores); labels and groups as the youth page shows them.
const YOUTH_TRAINING_TYPES = {
  9: { group: 'Focused skill training', label: 'Keeper', skills: ['keeper'] },
  3: { group: 'Focused skill training', label: 'Defending', skills: ['defending'] },
  8: { group: 'Focused skill training', label: 'Playmaking', skills: ['playmaking'] },
  5: { group: 'Focused skill training', label: 'Winger', skills: ['winger'] },
  7: { group: 'Focused skill training', label: 'Passing', skills: ['passing'] },
  4: { group: 'Focused skill training', label: 'Scoring', skills: ['scoring'] },
  2: { group: 'Focused skill training', label: 'Set pieces', skills: ['setpieces'] },
  11: { group: 'Extended skill training', label: 'Defending (Defenders, Keepers + All Midfielders)', skills: ['defending'] },
  12: { group: 'Extended skill training', label: 'Winger (Winger + Attackers)', skills: ['winger'] },
  10: { group: 'Extended skill training', label: 'Passing (Defenders + All Midfielders)', skills: ['passing'] },
  6: { group: 'Combined skill training', label: 'Scoring and Set Pieces', skills: ['scoring', 'setpieces'] },
  1: { group: 'Combined skill training', label: 'Individual', skills: YOUTH_SKILLS.map(([k]) => k), individual: true },
};
const INDIVIDUAL = 1;
// Menu order as on Hattrick's youth page (object keys would sort numerically).
const YOUTH_TRAINING_ORDER = [9, 3, 8, 5, 7, 4, 2, 11, 12, 10, 6, 1];

const SECONDARY_FACTOR = 2 / 3;
const SAME_TYPE_SECONDARY_FACTOR = 0.5;
// The formula is a community fit, so allow a wide correction, and pull
// toward 1 while few runs back it.
const PRIOR_LEVELS = 1.5;
const MIN_FACTOR = 0.25;
const MAX_FACTOR = 4;
const MAX_RUN_RATIO = 6;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_YEAR = 112;

// Individual training: odds that a player in a sector gets each skill, and
// how hard that skill trains (HO's IndividualWeeklyTraining). The rate is
// the matching focused type's.
const INDIVIDUAL_ODDS = {
  GK: { keeper: 0.4, defending: 0.4, setpieces: 0.2 },
  WB: { defending: 0.3, winger: 0.22, playmaking: 0.2, passing: 0.15, setpieces: 0.1 },
  CD: { defending: 0.35, playmaking: 0.3, passing: 0.25, setpieces: 0.1 },
  WI: { defending: 0.16, playmaking: 0.22, passing: 0.19, setpieces: 0.11, winger: 0.32 },
  IM: { defending: 0.28, playmaking: 0.36, passing: 0.24, setpieces: 0.12 },
  FW: { scoring: 0.38, winger: 0.29, passing: 0.22, setpieces: 0.11 },
};
const INDIVIDUAL_SKILL = {
  keeper: { mult: 0.5, typeId: 9 }, defending: { mult: 0.9, typeId: 3 }, winger: { mult: 0.6, typeId: 5 },
  playmaking: { mult: 0.8, typeId: 8 }, scoring: { mult: 0.6, typeId: 4 }, passing: { mult: 0.9, typeId: 7 },
  setpieces: { mult: 0.9, typeId: 2 },
};

// Hattrick's granular match positions → the six sectors.
const SECTOR = {
  GK: 'GK', KP: 'GK', CD: 'CD', LCD: 'CD', RCD: 'CD', CB: 'CD',
  WB: 'WB', LB: 'WB', RB: 'WB', LWB: 'WB', RWB: 'WB',
  WI: 'WI', LW: 'WI', RW: 'WI', LM: 'WI', RM: 'WI',
  IM: 'IM', CM: 'IM', LIM: 'IM', RIM: 'IM',
  FW: 'FW', CF: 'FW', LFW: 'FW', RFW: 'FW', ST: 'FW',
};

function sectorOf(position) {
  return SECTOR[(position || '').toUpperCase()] ?? null;
}

function daysBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / MS_PER_DAY;
}

// D(type): weeks the senior formula needs from 7 to 8 at 17 with a solid
// coach and full staff (HO's getTrainingDurationInWeeks).
const durationCache = new Map();
function typeDuration(typeId) {
  if (!durationCache.has(typeId)) {
    const g = schum.weeklyGain({
      skillLevel: 7, trainingTypeId: typeId, ageYears: 17, intensityPct: 100, staminaPct: 10,
      coachLevel: 7, assistantLevels: 10, timeFactor: 1,
    });
    durationCache.set(typeId, g && g.gainPerWeek > 0 ? 1 / g.gainPerWeek : null);
  }
  return durationCache.get(typeId);
}

/** Levels per week from 90 full minutes of a focused type, at this level and age. */
function fullWeeklyGain(typeId, level, ageYears) {
  const d = typeDuration(typeId);
  if (d == null || level == null || ageYears == null) return null;
  const weeks = (0.5 + 0.1 * level) * (1 + 0.14 * (ageYears - 15)) * d;
  return weeks > 0 ? 1 / weeks : null;
}

/** The training slots (primary/secondary) that act on a skill under a reported training row. */
function slotsFor(training, skillKey) {
  if (!training) return [];
  const out = [];
  for (const [slot, typeId] of [['primary', training.primary_type_id], ['secondary', training.secondary_type_id]]) {
    const type = typeId != null ? YOUTH_TRAINING_TYPES[typeId] : null;
    if (type && type.skills.includes(skillKey)) out.push({ slot, typeId, sameType: slot === 'secondary' && typeId === training.primary_type_id });
  }
  return out;
}

/**
 * Modeled levels per week for one skill, summed over the slots that train
 * it. Returns { gainPerWeek, tiers, assumptions } or null when nothing in
 * the reported training reaches this skill for this player.
 */
function youthWeeklyGain({ skillKey, level, training, ageYears, position, calibration = 1 }) {
  const sector = sectorOf(position);
  const assumptions = ['assumes 90 league minutes in the last match position (minutes aren\'t in the export)'];
  const tiers = [];
  let total = 0;
  for (const s of slotsFor(training, skillKey)) {
    const slotFactor = s.slot === 'primary' ? 1 : SECONDARY_FACTOR * (s.sameType ? SAME_TYPE_SECONDARY_FACTOR : 1);
    let gain = null;
    if (s.typeId === INDIVIDUAL) {
      if (!sector) continue;
      const odds = INDIVIDUAL_ODDS[sector][skillKey];
      if (!odds) continue;
      const base = fullWeeklyGain(INDIVIDUAL_SKILL[skillKey].typeId, level, ageYears);
      gain = base == null ? null : INDIVIDUAL_SKILL[skillKey].mult * odds * base;
      tiers.push(`${s.slot}: individual (${Math.round(odds * 100)}% odds as ${sector})`);
    } else {
      const { tier, timeFactor } = schum.positionTimeFactor(s.typeId, sector);
      const base = fullWeeklyGain(s.typeId, level, ageYears);
      if (timeFactor == null) assumptions.push('no last-match position: assumes a fully trained position');
      gain = base == null ? null : base * (timeFactor ?? 1);
      tiers.push(`${s.slot}: ${timeFactor == null ? 'position unknown' : tier}`);
    }
    if (gain) total += gain * slotFactor;
    if (s.slot === 'secondary') {
      assumptions.push(`secondary training at ${s.sameType ? '1/3 (same type as primary)' : '2/3'} of primary`);
    }
  }
  if (!tiers.length) return null;
  return { gainPerWeek: Math.min(1, total * calibration), tiers, assumptions: [...new Set(assumptions)] };
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

function ageYearsOf(snap) {
  return snap.age_years == null ? null : snap.age_years + (snap.age_days ?? 0) / DAYS_PER_YEAR;
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
      const training = youthTrainingOn(log, a.snapshot_date);
      const gain = youthWeeklyGain({ skillKey, level: ca, training, ageYears: ageYearsOf(a), position: a.last_match_position });
      if (!gain) {
        if (delta !== 0) run = null; // a gain the model can't explain
        continue;
      }
      if (delta < 0) { run = null; continue; }
      if (run) run.modeled += gain.gainPerWeek * (daysBetween(a.snapshot_date, b.snapshot_date) / 7);
      if (delta > 0) {
        if (run && run.modeled > 0) {
          const ratio = delta / run.modeled;
          if (ratio <= MAX_RUN_RATIO && ratio >= 1 / MAX_RUN_RATIO) {
            runs.push({
              playerId: player.youth_player_id, name: player.name, skill: label,
              from: run.from, to: b.snapshot_date, levels: delta, modeled: run.modeled,
            });
          }
        }
        run = { from: b.snapshot_date, modeled: 0 };
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

/** The academy's learned correction on the prior; same shape as calibration.js's. */
function computeYouthCalibration(log = getYouthTrainingLog(), history = historyByPlayer()) {
  const empty = { factor: 1, runs: 0, levelsObserved: 0, levelsModeled: 0, players: 0, confidence: 'none', recent: [] };
  if (!log.length) return empty;
  // Promoted/released players included: their history is just as valid.
  const players = db.prepare('SELECT youth_player_id, name FROM youth_players').all();
  const runs = players.flatMap((p) => runsForPlayer(p, history.get(p.youth_player_id) ?? [], log));
  if (!runs.length) return empty;

  const levelsObserved = runs.reduce((n, r) => n + r.levels, 0);
  const levelsModeled = runs.reduce((n, r) => n + r.modeled, 0);
  const raw = (levelsObserved + PRIOR_LEVELS) / (levelsModeled + PRIOR_LEVELS);
  return {
    factor: Math.round(Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, raw)) * 100) / 100,
    runs: runs.length,
    levelsObserved,
    levelsModeled: Math.round(levelsModeled * 100) / 100,
    players: new Set(runs.map((r) => r.playerId)).size,
    confidence: runs.length >= 8 ? 'high' : runs.length >= 3 ? 'medium' : 'low',
    recent: runs
      .sort((x, y) => (x.to < y.to ? 1 : -1))
      .slice(0, 8)
      .map((r) => ({ ...r, modeled: Math.round(r.modeled * 100) / 100 })),
  };
}

/**
 * Forward estimate for each skill the current training reaches, for one player.
 * @param {object} p { skills: [{key, label, current, potential}], ageYears, position, daysUntilAgeOut }
 */
function predictPlayer(p, snapshots, training, calibration, trainingSince, now = Date.now()) {
  const out = [];
  for (const s of p.skills) {
    // Individual training never reaches skills that don't fit the position.
    const slots = trainedSlots(training, s.key, p.position);
    if (!slots.length || s.current == null) continue;
    const base = { skillKey: s.key, skill: s.label, slots, current: s.current, potential: s.potential };
    if (s.potential != null && s.current >= s.potential) {
      out.push({ ...base, status: 'maxed' });
      continue;
    }

    const gainAt = (level, weeksAhead = 0) => youthWeeklyGain({
      skillKey: s.key, level, training, ageYears: p.ageYears + weeksAhead / 16, position: p.position, calibration,
    });
    const g = gainAt(s.current);
    if (!g || g.gainPerWeek <= 0) {
      out.push({ ...base, status: 'not_reached', tiers: g?.tiers ?? [] });
      continue;
    }

    // Progress banked since the last level-up seen in this skill; without
    // one it's unknown (0–100%), and the range says so.
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

    // Weeks to the known potential, level by level (higher levels and an
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
          beforeAgeOut: weeks * 1.2 <= ageOutWeeks ? 'yes' : weeks * 0.8 > ageOutWeeks ? 'no' : 'tight',
        };
      }
    }

    // The independent observed estimate (the senior squad's estimator), from
    // this player's own level-ups under the current training.
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
      tiers: g.tiers,
      assumptions: g.assumptions,
    });
  }
  return out;
}

/** Does the reported training reach this skill for a player in this position? Which slots? */
function trainedSlots(training, skillKey, position) {
  return slotsFor(training, skillKey)
    .filter((s) => s.typeId !== INDIVIDUAL || INDIVIDUAL_ODDS[sectorOf(position)]?.[skillKey])
    .map((s) => s.slot);
}

module.exports = {
  YOUTH_TRAINING_TYPES, YOUTH_TRAINING_ORDER, SKILL_LABEL,
  computeYouthCalibration, predictPlayer, trainedSlots, getYouthTrainingLog, historyByPlayer,
};
