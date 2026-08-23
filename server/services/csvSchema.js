// The one place that defines the CSV column contract — used by BOTH
// services/importCsv.js and services/exportCsv.js, so the template you
// download, the file you fill in, and the file you can later export are
// always the exact same shape. Never edit the column list in just one
// direction; add/remove a column here and both import and export follow.
const { SPECIALTIES, derivePositionLine } = require('../chpp/parse');

const POSITION_CODES = ['GK', 'CD', 'WB', 'WI', 'IM', 'FW'];

const COLUMNS = [
  'player_id', 'first_name', 'last_name', 'age_years', 'position_code', 'specialty',
  'tsi', 'salary', 'form', 'injury_weeks', 'transfer_listed',
  'skill_keeper', 'skill_defending', 'skill_playmaking', 'skill_winger',
  'skill_passing', 'skill_scoring', 'skill_setpieces', 'skill_stamina',
  'value_estimate', 'last_match_rating', 'last_match_date',
];

function specialtyIdByName(name) {
  if (!name) return 0;
  const idx = SPECIALTIES.findIndex((s) => s && s.toLowerCase() === name.trim().toLowerCase());
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

/**
 * Validates + normalizes one CSV record (already split into a header-keyed
 * object by lib/csv.js) into the shape services/importCsv.js writes to the
 * database. Returns { errors: string[], input } — input is only safe to use
 * once errors is empty.
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

  let positionCode = (record.position_code || '').trim().toUpperCase() || null;
  if (positionCode && !POSITION_CODES.includes(positionCode)) {
    err(`position_code "${record.position_code}" must be one of ${POSITION_CODES.join(', ')}, or left blank to auto-detect.`);
    positionCode = null;
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

  const salary = record.salary && record.salary.trim() !== '' ? parseIntOrNull(record.salary) : null;
  if (salary === undefined) err(`salary "${record.salary}" isn't a number.`);

  const form = record.form && record.form.trim() !== '' ? parseIntOrNull(record.form) : null;
  if (form === undefined) err(`form "${record.form}" isn't a number.`);

  const injuryWeeks = record.injury_weeks && record.injury_weeks.trim() !== '' ? parseIntOrNull(record.injury_weeks) : 0;
  if (injuryWeeks === undefined) err(`injury_weeks "${record.injury_weeks}" isn't a number.`);

  if (!positionCode) {
    positionCode = derivePositionLine(skills).code;
  }

  const input = {
    providedId,
    syntheticIdSeed: `${firstName}|${(record.last_name || '').trim()}`,
    firstName,
    lastName: (record.last_name || '').trim(),
    ageYears,
    positionCode,
    specialtyId: specialtyIdByName(record.specialty),
    tsi: tsi ?? null,
    salary,
    form,
    injuryWeeks: injuryWeeks ?? 0,
    transferListed: parseBool(record.transfer_listed),
    skills,
    lastMatchRating: record.last_match_rating && record.last_match_rating.trim() !== '' ? Number(record.last_match_rating) : null,
    lastMatchDate: record.last_match_date && record.last_match_date.trim() !== '' ? record.last_match_date.trim() : null,
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
    player_id: '', first_name: 'Erik', last_name: 'Nilsson', age_years: 24, position_code: '',
    specialty: 'Technical', tsi: 4200, salary: 18000, form: 6, injury_weeks: 0, transfer_listed: 0,
    skill_keeper: 1, skill_defending: 11, skill_playmaking: 6, skill_winger: 4, skill_passing: 7,
    skill_scoring: 2, skill_setpieces: 5, skill_stamina: 9, value_estimate: '', last_match_rating: '', last_match_date: '',
  };
}

module.exports = {
  COLUMNS, POSITION_CODES,
  stablePlayerId, csvRecordToPlayerInput, playerRowToCsvRecord, templateExampleRecord,
};
