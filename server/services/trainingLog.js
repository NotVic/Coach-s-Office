// What the club trained, when. One row per sync/import date, copied from
// the training_focus_* / coach / assistant settings that run just wrote, so
// the history survives the settings being overwritten next time. A row
// with a null training type means "not known on that date" (e.g. a CSV
// import without the training section) — that breaks calibration runs
// instead of silently assuming the previous training carried on.
const { db, getSetting } = require('../db');

const upsertStmt = db.prepare(`
  INSERT INTO training_log
    (log_date, training_type_id, skill_key, type_label, intensity_pct, stamina_pct, coach_level, assistant_levels, source)
  VALUES (@date, @typeId, @skillKey, @typeLabel, @intensityPct, @staminaPct, @coachLevel, @assistantLevels, @source)
  ON CONFLICT(log_date) DO UPDATE SET
    training_type_id = excluded.training_type_id, skill_key = excluded.skill_key, type_label = excluded.type_label,
    intensity_pct = excluded.intensity_pct, stamina_pct = excluded.stamina_pct, coach_level = excluded.coach_level,
    assistant_levels = excluded.assistant_levels, source = excluded.source
`);
const allStmt = db.prepare('SELECT * FROM training_log ORDER BY log_date ASC');

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/** Record the training settings currently in kv_settings against `date` (YYYY-MM-DD). */
function recordTraining(date) {
  const typeId = numOrNull(getSetting('training_focus_type_id'));
  upsertStmt.run({
    date,
    typeId,
    skillKey: typeId != null ? getSetting('training_focus_skill') : null,
    typeLabel: typeId != null ? getSetting('training_focus_type_label') : null,
    intensityPct: numOrNull(getSetting('training_focus_intensity_pct')),
    staminaPct: numOrNull(getSetting('training_focus_stamina_pct')),
    coachLevel: numOrNull(getSetting('coach_skill_level')),
    assistantLevels: numOrNull(getSetting('assistant_levels')),
    source: getSetting('training_focus_source'),
  });
}

function getTrainingLog() {
  return allStmt.all();
}

/**
 * The log entry in force on `date`: the latest one recorded on or before it.
 * Hattrick applies training weekly with whatever is set at the time, and a
 * sync only ever sees the current setting, so the last-known setting is the
 * best available answer for the days after it.
 */
function trainingOn(log, date) {
  let hit = null;
  for (const row of log) {
    if (row.log_date > date) break;
    hit = row;
  }
  return hit;
}

/**
 * Collapse the log into periods of unchanged training type, newest first —
 * the "what was trained when" view. Intensity/stamina/staff changes inside a
 * period are kept as the latest values, with a flag that they varied.
 */
function trainingPeriods(log = getTrainingLog()) {
  const periods = [];
  for (const row of log) {
    const cur = periods[periods.length - 1];
    if (cur && cur.typeId === row.training_type_id) {
      cur.lastSeen = row.log_date;
      cur.records += 1;
      if (cur.intensityPct !== row.intensity_pct || cur.staminaPct !== row.stamina_pct) cur.settingsVaried = true;
      cur.intensityPct = row.intensity_pct;
      cur.staminaPct = row.stamina_pct;
      cur.coachLevel = row.coach_level;
      cur.assistantLevels = row.assistant_levels;
      continue;
    }
    if (cur) cur.until = row.log_date;
    periods.push({
      typeId: row.training_type_id,
      skillKey: row.skill_key,
      typeLabel: row.type_label,
      from: row.log_date,
      lastSeen: row.log_date,
      until: null,
      records: 1,
      intensityPct: row.intensity_pct,
      staminaPct: row.stamina_pct,
      coachLevel: row.coach_level,
      assistantLevels: row.assistant_levels,
      settingsVaried: false,
    });
  }
  return periods.reverse();
}

/** First date the current training type has been continuously recorded since, or null. */
function currentTrainingSince(log = getTrainingLog()) {
  const latest = trainingPeriods(log)[0];
  return latest && latest.typeId != null ? latest.from : null;
}

module.exports = { recordTraining, getTrainingLog, trainingOn, trainingPeriods, currentTrainingSince };
