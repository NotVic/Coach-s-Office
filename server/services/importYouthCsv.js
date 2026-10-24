// Youth academy import — Hattrick's youth-players CSV export, uploaded as-is.
//
// That export repeats each skill header: "Keeper,Keeper" is the current
// level followed by the potential (maximum) as "/6". Hattrick only reveals
// these gradually (scout report, coach comments after matches, training),
// so any half can be "?" or blank — both stored as NULL ("not revealed
// yet"), never as 0, which would read as a real "non-existent" level.
//
// Like the senior import, each upload replaces the academy (players missing
// from the file are marked inactive — promoted or released) and adds one
// dated snapshot per player, so level-ups and new revelations show up as
// history across imports.
const { parseCsv } = require('../lib/csv');
const { db, withTransaction } = require('../db');
const { localDate } = require('../lib/dates');
const { SPECIALTIES } = require('../chpp/parse');

const YOUTH_SKILLS = [
  ['keeper', 'Keeper'], ['defending', 'Defending'], ['playmaking', 'Playmaking'],
  ['winger', 'Winger'], ['passing', 'Passing'], ['scoring', 'Scoring'], ['setpieces', 'Set Pieces'],
];

// Unique to the youth export — used to tell it apart from the senior one.
const YOUTH_FORMAT_MARKER = 'Days until you can promote';

function isYouthFormat(headers) {
  return headers.includes(YOUTH_FORMAT_MARKER);
}

/** Local calendar day (see lib/dates.js). */
function today() {
  return localDate();
}

/** "5" → 5, "/6" → 6, "?" / "/?" / "" → null (not revealed); anything else → undefined (invalid). */
function parseLevel(raw) {
  const s = (raw || '').trim().replace(/^\//, '');
  if (s === '' || s === '?') return null;
  return /^\d{1,2}$/.test(s) ? Number(s) : undefined;
}

function parseIntOrNull(raw) {
  const s = (raw || '').trim();
  if (s === '') return null;
  return /^-?\d+$/.test(s) ? Number(s) : undefined;
}

function parseDate(raw) {
  const m = (raw || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

/** Long specialty name for Hattrick's shortened export values ("Head" → "Head Specialist"). */
function specialtyName(raw) {
  const norm = (raw || '').trim().toLowerCase();
  if (!norm) return null;
  return SPECIALTIES.find((s) => s && (s.toLowerCase() === norm || s.toLowerCase().startsWith(norm))) || raw.trim();
}

/** Column index of each skill's current and potential half. */
function skillColumns(headers) {
  const cols = {};
  const missing = [];
  for (const [key, header] of YOUTH_SKILLS) {
    const first = headers.indexOf(header);
    const second = first === -1 ? -1 : headers.indexOf(header, first + 1);
    if (first === -1 || second === -1) missing.push(header);
    cols[key] = { cur: first, max: second };
  }
  return { cols, missing };
}

/**
 * @param {string} csvText raw file contents
 * @param {{primaryTypeId: number|null, secondaryTypeId: number|null}} [training]
 *   the academy's training as set in Hattrick (TRAINING_TYPES ids), reported
 *   in the upload form since the export doesn't include it. Same rule as the
 *   senior import: what's left blank is recorded as unknown, not carried over.
 * @returns {{ok: true, playerCount: number, released: number} | {ok: false, errors: string[]}}
 */
function importYouthCsv(csvText, training = {}) {
  const { headers, rows } = parseCsv(csvText);
  if (headers.length === 0 || rows.length === 0) {
    return { ok: false, errors: ['The file is empty, or has no data rows below the header row.'] };
  }
  if (!isYouthFormat(headers)) {
    return { ok: false, errors: [`This doesn't look like Hattrick's youth-players export (no "${YOUTH_FORMAT_MARKER}" column).`] };
  }
  const { cols, missing } = skillColumns(headers);
  if (missing.length) {
    return { ok: false, errors: [`Expected each skill twice (current, then potential); missing for: ${missing.join(', ')}.`] };
  }
  const col = (name) => headers.indexOf(name);

  const errors = [];
  const players = rows.map((r, i) => {
    const rowNumber = i + 2;
    const err = (msg) => errors.push(`Row ${rowNumber}: ${msg}`);
    const get = (name) => (col(name) === -1 ? '' : r[col(name)]);
    const int = (name) => {
      const v = parseIntOrNull(get(name));
      if (v === undefined) err(`${name} "${get(name)}" isn't a whole number.`);
      return v ?? null;
    };

    const id = parseIntOrNull(get('PlayerID'));
    if (id == null || id === undefined || id <= 0) err('PlayerID is required and must be a positive whole number.');
    const name = get('Name');
    if (!name) err('Name is required.');

    const skills = {};
    for (const [key, header] of YOUTH_SKILLS) {
      const cur = parseLevel(r[cols[key].cur]);
      const max = parseLevel(r[cols[key].max]);
      if (cur === undefined) err(`${header} (current) "${r[cols[key].cur]}" isn't a skill level.`);
      if (max === undefined) err(`${header} (potential) "${r[cols[key].max]}" isn't a skill level.`);
      skills[key] = { cur: cur ?? null, max: max ?? null };
    }

    const rating = get('Last match rating');
    return {
      id, name,
      nationality: get('Nationality') || null,
      specialty: specialtyName(get('Specialty')),
      ageYears: int('Age'),
      ageDays: int('Days'),
      daysUntilPromotion: int('Days until you can promote'),
      promotionAgeYears: int('Age at promotion'),
      promotionAgeDays: int('Days at promotion'),
      injuryWeeks: int('Injuries') ?? 0,
      warnings: int('Warnings') ?? 0,
      lastMatchDate: parseDate(get('Last match date')),
      lastMatchRating: rating && !Number.isNaN(Number(rating)) ? Number(rating) : null,
      lastMatchPosition: get('Last match position') || null,
      skills,
    };
  });

  const seen = new Set();
  players.forEach((p, i) => {
    if (p.id == null) return;
    if (seen.has(p.id)) errors.push(`Row ${i + 2}: PlayerID ${p.id} appears more than once.`);
    seen.add(p.id);
  });
  if (errors.length) return { ok: false, errors };

  const date = today();
  const skillKeys = YOUTH_SKILLS.map(([k]) => k);
  const skillColNames = skillKeys.flatMap((k) => [`cur_${k}`, `max_${k}`]);
  const skillParams = (p) => skillKeys.flatMap((k) => [p.skills[k].cur, p.skills[k].max]);

  const upsertPlayer = db.prepare(`
    INSERT INTO youth_players (
      youth_player_id, name, nationality, specialty, age_years, age_days, days_until_promotion,
      promotion_age_years, promotion_age_days, injury_weeks, warnings, last_match_date,
      last_match_rating, last_match_position, ${skillColNames.join(', ')}, as_of_date, first_seen_date, is_active
    ) VALUES (${Array(14 + skillColNames.length + 2).fill('?').join(', ')}, 1)
    ON CONFLICT(youth_player_id) DO UPDATE SET
      name = excluded.name, nationality = excluded.nationality, specialty = excluded.specialty,
      age_years = excluded.age_years, age_days = excluded.age_days,
      days_until_promotion = excluded.days_until_promotion,
      promotion_age_years = excluded.promotion_age_years, promotion_age_days = excluded.promotion_age_days,
      injury_weeks = excluded.injury_weeks, warnings = excluded.warnings,
      last_match_date = excluded.last_match_date, last_match_rating = excluded.last_match_rating,
      last_match_position = excluded.last_match_position,
      ${skillColNames.map((c) => `${c} = excluded.${c}`).join(', ')},
      as_of_date = excluded.as_of_date, is_active = 1
  `);
  const upsertSnapshot = db.prepare(`
    INSERT OR REPLACE INTO youth_snapshots (
      youth_player_id, snapshot_date, age_years, age_days, last_match_date, last_match_rating,
      last_match_position, ${skillColNames.join(', ')}
    ) VALUES (${Array(7 + skillColNames.length).fill('?').join(', ')})
  `);

  const released = withTransaction(() => {
    for (const p of players) {
      upsertPlayer.run(
        p.id, p.name, p.nationality, p.specialty, p.ageYears, p.ageDays, p.daysUntilPromotion,
        p.promotionAgeYears, p.promotionAgeDays, p.injuryWeeks, p.warnings, p.lastMatchDate,
        p.lastMatchRating, p.lastMatchPosition, ...skillParams(p), date, date,
      );
      upsertSnapshot.run(
        p.id, date, p.ageYears, p.ageDays, p.lastMatchDate, p.lastMatchRating, p.lastMatchPosition, ...skillParams(p),
      );
    }
    db.prepare('INSERT OR REPLACE INTO youth_training_log (log_date, primary_type_id, secondary_type_id) VALUES (?, ?, ?)')
      .run(date, training.primaryTypeId ?? null, training.secondaryTypeId ?? null);
    return db.prepare(`UPDATE youth_players SET is_active = 0 WHERE is_active = 1 AND youth_player_id NOT IN (SELECT value FROM json_each(?))`)
      .run(JSON.stringify(players.map((p) => p.id))).changes;
  });

  db.prepare('INSERT INTO sync_log (ran_at, kind, status, message) VALUES (?, ?, ?, ?)')
    .run(new Date().toISOString(), 'youth_csv_import', 'ok', `${players.length} youth players, ${released} no longer in the academy`);
  return { ok: true, playerCount: players.length, released };
}

module.exports = { importYouthCsv, isYouthFormat, YOUTH_SKILLS };
