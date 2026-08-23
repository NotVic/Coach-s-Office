// The CSV column contracts — used by BOTH services/importCsv.js and
// services/exportCsv.js, so there's never a second, drifting definition of
// a format.
//
// Two input formats are accepted on import, auto-detected by header:
//  1. "hattrick" — the columns Hattrick's own Players-page export uses
//     (Name, PlayerID, TSI, Wage, Keeper, Defending, ... Last match
//     position, etc.) — upload that file directly, no editing needed.
//  2. "template" — this app's own simpler column set (see COLUMNS below),
//     for hand-typing a squad from scratch. Download it from Settings.
// Export always writes the "template" format, since it's a superset that
// round-trips everything this app tracks (including its own value
// estimate, which Hattrick's export naturally has no equivalent for).
const { SPECIALTIES, derivePositionLine } = require('../chpp/parse');

const POSITION_CODES = ['GK', 'CD', 'WB', 'WI', 'IM', 'FW'];

// Hattrick's own position vocabulary is more granular than the 4-line model
// the rest of this app uses (see BRAND_GUIDELINES's position-pill system) —
// collapse the granular codes down to it.
const POSITION_ALIASES = {
  GK: 'GK', CD: 'CD', WB: 'WB', WI: 'WI', IM: 'IM', FW: 'FW',
  LB: 'WB', RB: 'WB', LW: 'WI', RW: 'WI',
};

const COLUMNS = [
  'player_id', 'first_name', 'last_name', 'age_years', 'age_days', 'position_code', 'specialty',
  'tsi', 'salary', 'form', 'injury_weeks', 'transfer_listed',
  'skill_keeper', 'skill_defending', 'skill_playmaking', 'skill_winger',
  'skill_passing', 'skill_scoring', 'skill_setpieces', 'skill_stamina',
  'value_estimate', 'last_match_rating', 'last_match_date',
];

// Columns unique to Hattrick's own export, used only to detect the format —
// not an exhaustive list of what's read from it (see HATTRICK_SKILL_HEADERS
// and hattrickRecordToPlayerInput below).
const HATTRICK_FORMAT_MARKERS = ['PlayerID', 'Name'];

const HATTRICK_SKILL_HEADERS = {
  keeper: 'Keeper', defending: 'Defending', playmaking: 'Playmaking', winger: 'Winger',
  passing: 'Passing', scoring: 'Scoring', setpieces: 'Set Pieces', stamina: 'Stamina',
};

function detectFormat(headers) {
  return HATTRICK_FORMAT_MARKERS.every((h) => headers.includes(h)) ? 'hattrick' : 'template';
}

function normalizePositionCode(raw) {
  const code = (raw || '').trim().toUpperCase();
  return POSITION_ALIASES[code] || null;
}

/** Case-insensitive, alias-tolerant (e.g. Hattrick's export shortens "Head Specialist" to "Head"). */
function specialtyIdByName(name) {
  const norm = (name || '').trim().toLowerCase();
  if (!norm) return 0;
  let idx = SPECIALTIES.findIndex((s) => s && s.toLowerCase() === norm);
  if (idx === -1) idx = SPECIALTIES.findIndex((s) => s && s.toLowerCase().startsWith(norm));
  return idx === -1 ? 0 : idx;
}

/** Simple deterministic djb2-style hash, mapped to a negative int — see importCsv.js for why negative. */
function stablePlayerId(seed) {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash * 33) ^ seed.charCodeAt(i)) >>> 0;
  }
  return -((hash % 2000000000) + 1);
}

function parseIntOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n; // undefined signals "invalid, not just absent"
}

function parseBool(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y'].includes(s);
}

/** "16.08.2026" (Hattrick's own D.M.YYYY export format) -> "2026-08-16". Returns null if unparseable/blank. */
function parseHattrickDate(raw) {
  const m = (raw || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function splitFullName(fullName) {
  const trimmed = (fullName || '').trim();
  const spaceAt = trimmed.indexOf(' ');
  return spaceAt === -1
    ? { firstName: trimmed, lastName: '' }
    : { firstName: trimmed.slice(0, spaceAt), lastName: trimmed.slice(spaceAt + 1) };
}

/**
 * Validates + normalizes one CSV record (already split into a header-keyed
 * object by lib/csv.js) from THIS app's own simple template format into the
 * shape services/importCsv.js writes to the database. Returns
 * { errors: string[], input } — input is only safe to use once errors is empty.
 */
function csvRecordToPlayerInput(record, rowNumber) {
  const errors = [];
  const err = (msg) => errors.push(`Row ${rowNumber}: ${msg}`);

  const firstName = (record.first_name || '').trim();
  if (!firstName) err('first_name is required.');

  const tsi = parseIntOrNull(record.tsi);
  if (tsi === undefined) err(`tsi "${record.tsi}" isn't a number.`);
  else if (tsi == null) err('tsi is required.');

  let providedId = null;
  if (record.player_id && record.player_id.trim() !== '') {
    const n = parseIntOrNull(record.player_id);
    if (n === undefined || n <= 0) err(`player_id "${record.player_id}" must be a positive whole number, or left blank.`);
    else providedId = n;
  }

  let positionCode = record.position_code ? normalizePositionCode(record.position_code) : null;
  if (record.position_code && record.position_code.trim() && !positionCode) {
    err(`position_code "${record.position_code}" must be one of ${POSITION_CODES.join(', ')} (or GK/CD/LB/RB/LW/RW/IM/FW), or left blank to auto-detect.`);
  }

  const skillFields = ['keeper', 'defending', 'playmaking', 'winger', 'passing', 'scoring', 'setpieces', 'stamina'];
  const skills = {};
  for (const key of skillFields) {
    const raw = record[`skill_${key}`];
    const n = raw && raw.trim() !== '' ? parseIntOrNull(raw) : 0;
    if (n === undefined) err(`skill_${key} "${raw}" isn't a number.`);
    skills[key] = n ?? 0;
  }

  const ageYears = record.age_years && record.age_years.trim() !== '' ? parseIntOrNull(record.age_years) : null;
  if (ageYears === undefined) err(`age_years "${record.age_years}" isn't a number.`);

  const ageDays = record.age_days && record.age_days.trim() !== '' ? parseIntOrNull(record.age_days) : null;
  if (ageDays === undefined) err(`age_days "${record.age_days}" isn't a number.`);

  const salary = record.salary && record.salary.trim() !== '' ? parseIntOrNull(record.salary) : null;
  if (salary === undefined) err(`salary "${record.salary}" isn't a number.`);

  const form = record.form && record.form.trim() !== '' ? parseIntOrNull(record.form) : null;
  if (form === undefined) err(`form "${record.form}" isn't a number.`);

  const injuryWeeks = record.injury_weeks && record.injury_weeks.trim() !== '' ? parseIntOrNull(record.injury_weeks) : 0;
  if (injuryWeeks === undefined) err(`injury_weeks "${record.injury_weeks}" isn't a number.`);

  if (!positionCode) positionCode = derivePositionLine(skills).code;

  const input = {
    providedId,
    syntheticIdSeed: `${firstName}|${(record.last_name || '').trim()}`,
    firstName,
    lastName: (record.last_name || '').trim(),
    ageYears, ageDays, positionCode,
    specialtyId: specialtyIdByName(record.specialty),
    tsi: tsi ?? null, salary, form, experience: null, leadership: null,
    injuryWeeks: injuryWeeks ?? 0,
    transferListed: parseBool(record.transfer_listed),
    skills,
    lastMatchRating: record.last_match_rating && record.last_match_rating.trim() !== '' ? Number(record.last_match_rating) : null,
    lastMatchDate: record.last_match_date && record.last_match_date.trim() !== '' ? record.last_match_date.trim() : null,
  };

  return { errors, input };
}

/**
 * Same contract as csvRecordToPlayerInput, but reading Hattrick's own
 * Players-page export column names directly — upload that file as-is.
 */
function hattrickRecordToPlayerInput(record, rowNumber) {
  const errors = [];
  const err = (msg) => errors.push(`Row ${rowNumber}: ${msg}`);

  const { firstName, lastName } = splitFullName(record.Name);
  if (!firstName) err('Name is required.');

  const idRaw = (record.PlayerID || '').trim();
  const providedId = parseIntOrNull(idRaw);
  if (!idRaw) err('PlayerID is required (this is what keeps training-ETA history stable across re-imports).');
  else if (providedId === undefined || providedId <= 0) err(`PlayerID "${idRaw}" must be a positive whole number.`);

  const tsi = parseIntOrNull(record.TSI);
  if (tsi === undefined) err(`TSI "${record.TSI}" isn't a number.`);
  else if (tsi == null) err('TSI is required.');

  const skills = {};
  for (const [key, header] of Object.entries(HATTRICK_SKILL_HEADERS)) {
    const n = parseIntOrNull(record[header]);
    if (n === undefined) err(`${header} "${record[header]}" isn't a number.`);
    skills[key] = n ?? 0;
  }

  const ageYears = parseIntOrNull(record.Age);
  if (ageYears === undefined) err(`Age "${record.Age}" isn't a number.`);
  const ageDays = parseIntOrNull(record.Days);
  if (ageDays === undefined) err(`Days "${record.Days}" isn't a number.`);
  const salary = parseIntOrNull(record.Wage);
  if (salary === undefined) err(`Wage "${record.Wage}" isn't a number.`);
  const experience = parseIntOrNull(record.Experience);
  if (experience === undefined) err(`Experience "${record.Experience}" isn't a number.`);
  const leadership = parseIntOrNull(record.Leadership);
  if (leadership === undefined) err(`Leadership "${record.Leadership}" isn't a number.`);
  const form = parseIntOrNull(record.Form);
  if (form === undefined) err(`Form "${record.Form}" isn't a number.`);

  const injuryRaw = record.Injuries;
  const injuryWeeks = injuryRaw && injuryRaw.trim() !== '' ? parseIntOrNull(injuryRaw) : 0;
  if (injuryWeeks === undefined) err(`Injuries "${injuryRaw}" isn't a number.`);

  // "Last match position" reflects the position last *played*, not a fixed
  // role — a blank/unrecognized value (e.g. a player who hasn't played yet)
  // just falls back to skill-derived, same as the template format.
  const positionCode = normalizePositionCode(record['Last match position']) || derivePositionLine(skills).code;

  const input = {
    providedId: idRaw ? providedId : null,
    syntheticIdSeed: `${firstName}|${lastName}`,
    firstName, lastName, ageYears, ageDays, positionCode,
    specialtyId: specialtyIdByName(record.Specialty),
    tsi: tsi ?? null, salary, form, experience, leadership,
    injuryWeeks: injuryWeeks ?? 0,
    transferListed: parseBool(record['Transfer-listed']),
    skills,
    lastMatchRating: record['Last match rating'] && record['Last match rating'].trim() !== '' ? Number(record['Last match rating']) : null,
    lastMatchDate: parseHattrickDate(record['Last match date']),
  };

  return { errors, input };
}

/** DB player row (SELECT * FROM players) -> a plain object keyed by CSV header, for lib/csv.js's buildCsv. */
function playerRowToCsvRecord(p) {
  return {
    player_id: p.player_id,
    first_name: p.first_name,
    last_name: p.last_name,
    age_years: p.age_years ?? '',
    age_days: p.age_days ?? '',
    position_code: p.position_code ?? '',
    specialty: p.specialty ?? '',
    tsi: p.tsi ?? '',
    salary: p.salary ?? '',
    form: p.form ?? '',
    injury_weeks: p.injury_weeks ?? 0,
    transfer_listed: p.transfer_listed ? 1 : 0,
    skill_keeper: p.skill_keeper ?? '',
    skill_defending: p.skill_defending ?? '',
    skill_playmaking: p.skill_playmaking ?? '',
    skill_winger: p.skill_winger ?? '',
    skill_passing: p.skill_passing ?? '',
    skill_scoring: p.skill_scoring ?? '',
    skill_setpieces: p.skill_setpieces ?? '',
    skill_stamina: p.skill_stamina ?? '',
    value_estimate: p.value_estimate ?? '',
    last_match_rating: p.last_match_rating ?? '',
    last_match_date: p.last_match_date ?? '',
  };
}

function templateExampleRecord() {
  return {
    player_id: '', first_name: 'Erik', last_name: 'Nilsson', age_years: 24, age_days: '', position_code: '',
    specialty: 'Technical', tsi: 4200, salary: 18000, form: 6, injury_weeks: 0, transfer_listed: 0,
    skill_keeper: 1, skill_defending: 11, skill_playmaking: 6, skill_winger: 4, skill_passing: 7,
    skill_scoring: 2, skill_setpieces: 5, skill_stamina: 9, value_estimate: '', last_match_rating: '', last_match_date: '',
  };
}

module.exports = {
  COLUMNS, POSITION_CODES,
  detectFormat, stablePlayerId,
  csvRecordToPlayerInput, hattrickRecordToPlayerInput,
  playerRowToCsvRecord, templateExampleRecord,
};
