// Calibrating the Schum model (services/schum.js) against this club's own
// history. The formula's inputs are partly guessed (coach and intensity can
// be missing, minutes played never are known), so its weekly gain is
// systematically off by some club-specific amount. Every pair of observed
// level-ups in a trained skill is a measurement of that: between them the
// player gained exactly the levels CHPP reported, while the model — replayed
// with the training actually logged for each interval (services/trainingLog.js),
// the player's position and age at the time, and injury weeks taken out —
// predicted some other amount. The ratio, pooled over all such runs, is the
// correction factor applied to every forward estimate.
//
// A run only counts from one observed level-up to the next: the first
// level-up after tracking starts can't be used, because the progress
// banked before tracking began is unknown. Any interval with unknown
// training, or an unexplained level change (a drop, or a gain while the
// skill wasn't being trained), breaks the run.
const { db } = require('../db');
const schum = require('./schum');
const { getTrainingLog, trainingOn } = require('./trainingLog');

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// A Hattrick year is 112 days (16 weeks).
const DAYS_PER_HT_YEAR = 112;
// Pseudo-observation pulling the factor toward 1 (the uncalibrated model):
// one level-up's worth, so a single lucky or unlucky run moves it only part way.
const PRIOR_LEVELS = 1;
const MIN_FACTOR = 0.5;
const MAX_FACTOR = 2;
// A single run implying the model is off by more than this is far more
// likely a data problem (a position change, a missed import) than training.
const MAX_RUN_RATIO = 4;

function daysBetween(isoA, isoB) {
  return (new Date(isoB).getTime() - new Date(isoA).getTime()) / MS_PER_DAY;
}

/** The player's (fractional) age on `date`, back-dated from their last known age. */
function ageOn(player, date) {
  if (player.age_years == null) return null;
  const ref = player.updated_at || new Date().toISOString();
  const days = player.age_years * DAYS_PER_HT_YEAR + (player.age_days ?? 0) - daysBetween(date, ref);
  return days / DAYS_PER_HT_YEAR;
}

/** Modeled net progress (fraction of a level) for one snapshot interval. */
function modeledInterval(player, a, b, training, skillKey) {
  const weeks = daysBetween(a.snapshot_date, b.snapshot_date) / 7;
  const age = ageOn(player, a.snapshot_date);
  const level = a[skillKey];
  if (weeks <= 0 || age == null || level == null) return 0;
  const { timeFactor } = schum.positionTimeFactor(training.training_type_id, a.position_code ?? player.position_code);
  // Injured players don't train; the snapshot's injury estimate is the best
  // available proxy for how much of the interval they missed.
  const trainWeeks = Math.max(0, weeks - (a.injury_weeks > 0 ? a.injury_weeks : 0));
  const gain = timeFactor ? schum.weeklyGain({
    skillLevel: level,
    trainingTypeId: training.training_type_id,
    ageYears: age,
    intensityPct: training.intensity_pct,
    staminaPct: training.stamina_pct,
    coachLevel: training.coach_level,
    assistantLevels: training.assistant_levels,
    timeFactor,
  }) : null;
  const drop = schum.weeklyDrop({ skillLevel: level, ageYears: Math.floor(age), skillKey, isTrained: true });
  return (gain ? gain.gainPerWeek * trainWeeks : 0) - drop * weeks;
}

/** Every complete level-up-to-level-up run for one player's history. */
function runsForPlayer(player, snapshots, log) {
  const runs = [];
  const skillKeys = new Set(log.map((r) => r.skill_key).filter(Boolean));
  for (const skillKey of skillKeys) {
    let run = null;
    for (let i = 0; i < snapshots.length - 1; i++) {
      const a = snapshots[i];
      const b = snapshots[i + 1];
      const training = trainingOn(log, a.snapshot_date);
      const delta = (b[skillKey] ?? 0) - (a[skillKey] ?? 0);
      if (!training || training.training_type_id == null) { run = null; continue; }
      if (training.skill_key !== skillKey) {
        if (delta !== 0) run = null;
        continue;
      }
      if (delta < 0) { run = null; continue; }
      if (run) run.modeled += modeledInterval(player, a, b, training, skillKey);
      if (delta > 0) {
        if (run && run.modeled > 0 && delta / run.modeled <= MAX_RUN_RATIO && delta / run.modeled >= 1 / MAX_RUN_RATIO) {
          runs.push({
            playerId: player.player_id,
            name: `${player.first_name ?? ''} ${player.last_name ?? ''}`.trim(),
            skillKey,
            from: run.from,
            to: b.snapshot_date,
            levels: delta,
            modeled: run.modeled,
          });
        }
        run = { from: b.snapshot_date, modeled: 0 };
      }
    }
  }
  return runs;
}

/**
 * @returns {{factor: number, runs: number, levelsObserved: number,
 *   levelsModeled: number, players: number, confidence: string, recent: Array}}
 *   factor multiplies the model's weekly gain; 1 = no correction.
 */
function computeCalibration(teamId) {
  const log = getTrainingLog();
  const empty = { factor: 1, runs: 0, levelsObserved: 0, levelsModeled: 0, players: 0, confidence: 'none', recent: [] };
  if (!teamId || !log.length) return empty;

  // Sold/released players included: their history is just as valid a measurement.
  const players = db.prepare('SELECT * FROM players WHERE team_id = ?').all(teamId);
  const snapshots = db.prepare(
    `SELECT ps.* FROM player_snapshots ps JOIN players p ON p.player_id = ps.player_id
     WHERE p.team_id = ? ORDER BY ps.player_id, ps.snapshot_date ASC`
  ).all(teamId);
  const historyOf = new Map();
  for (const s of snapshots) {
    if (!historyOf.has(s.player_id)) historyOf.set(s.player_id, []);
    historyOf.get(s.player_id).push(s);
  }

  const runs = players.flatMap((p) => runsForPlayer(p, historyOf.get(p.player_id) ?? [], log));
  if (!runs.length) return empty;

  const levelsObserved = runs.reduce((n, r) => n + r.levels, 0);
  const levelsModeled = runs.reduce((n, r) => n + r.modeled, 0);
  const raw = (levelsObserved + PRIOR_LEVELS) / (levelsModeled + PRIOR_LEVELS);
  const factor = Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, raw));

  return {
    factor: Math.round(factor * 100) / 100,
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

module.exports = { computeCalibration, ageOn };
