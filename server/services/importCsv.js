// CSV import — a stand-in for the CHPP connection while you're waiting on
// your consumer keys (or just prefer a spreadsheet). Accepts either
// Hattrick's own Players-page export as-is, or this app's own simpler
// template (see services/csvSchema.js for both column contracts and the
// format auto-detection). Writes into the exact same tables
// services/sync.js does via services/store.js, so the dashboard, player
// detail, and digest all work identically regardless of where the data
// came from. Match Prep still needs a real CHPP connection (it needs live
// fixture + opponent data), and this data gets superseded — not merged —
// once you actually connect, since a real Hattrick team has a different,
// real team ID.
const { parseCsv } = require('../lib/csv');
const { setSetting, withTransaction, db } = require('../db');
const { estimateValue } = require('./valuation');
const { detectFormat, csvRecordToPlayerInput, hattrickRecordToPlayerInput, stablePlayerId } = require('./csvSchema');
const { SPECIALTIES } = require('../chpp/parse');
const store = require('./store');

// Fixed sentinel, chosen well outside any real Hattrick team ID's range
// (teams have existed since 1997 and are nowhere near this number), so a
// CSV-imported "team" never collides with a real one once you connect.
const CSV_IMPORT_TEAM_ID = 900000000;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function logImport(status, message) {
  db.prepare('INSERT INTO sync_log (ran_at, kind, status, message) VALUES (?, ?, ?, ?)')
    .run(new Date().toISOString(), 'csv_import', status, message ?? null);
}

/**
 * @param {string} csvText raw file contents
 * @param {string} teamName display name for the dashboard header
 * @param {{cash?: number, weeklyIncome?: number, weeklyExpenses?: number}} [finances]
 *   optional — Hattrick's per-player export has no team-finance columns, so
 *   these come from the Settings form instead if the manager wants the net
 *   income chart to have something to show.
 * @returns {{ok: true, format, playerCount, teamTsi, teamWorth} | {ok: false, errors: string[]}}
 */
function importSquadCsv(csvText, teamName, finances = {}) {
  const { headers, records } = parseCsv(csvText);
  if (headers.length === 0 || records.length === 0) {
    return { ok: false, errors: ['The file is empty, or has no data rows below the header row.'] };
  }

  const format = detectFormat(headers);
  const mapRecord = format === 'hattrick' ? hattrickRecordToPlayerInput : csvRecordToPlayerInput;

  const errors = [];
  const inputs = records.map((record, i) => {
    const { errors: rowErrors, input } = mapRecord(record, i + 2); // +2: header is row 1, records are 1-indexed for humans
    errors.push(...rowErrors);
    return input;
  });

  if (errors.length > 0) {
    logImport('rejected', `${errors.length} validation error(s)`);
    return { ok: false, errors };
  }

  // Resolve player IDs (provided or stable-hashed from name) and catch
  // collisions before writing anything — two rows landing on the same ID
  // would silently overwrite one another otherwise.
  const idOf = new Map(); // resolved id -> row description, to report collisions
  const resolved = inputs.map((input, i) => {
    const id = input.providedId ?? stablePlayerId(input.syntheticIdSeed);
    const label = `${input.firstName} ${input.lastName}`.trim() || `row ${i + 2}`;
    if (idOf.has(id)) {
      errors.push(`Row ${i + 2}: "${label}" resolves to the same player_id as "${idOf.get(id)}" — add explicit, distinct player_id values for both (this usually means two players share a name).`);
    } else {
      idOf.set(id, label);
    }
    return { ...input, resolvedId: id };
  });

  if (errors.length > 0) {
    logImport('rejected', `${errors.length} ID collision error(s)`);
    return { ok: false, errors };
  }

  const date = today();

  const runInTransaction = () => {
    let teamTsi = 0;
    let teamWorth = 0;

    for (const p of resolved) {
      const valueEstimate = estimateValue({ tsi: p.tsi, ageYears: p.ageYears, specialtyId: p.specialtyId });
      teamTsi += p.tsi || 0;
      teamWorth += valueEstimate || 0;

      const row = {
        playerId: p.resolvedId, teamId: CSV_IMPORT_TEAM_ID, firstName: p.firstName, lastName: p.lastName,
        nickname: '', ageYears: p.ageYears, ageDays: p.ageDays,
        positionCode: p.positionCode, specialty: p.specialtyId ? SPECIALTIES[p.specialtyId] : null,
        tsi: p.tsi, salary: p.salary, form: p.form, experience: p.experience, leadership: p.leadership,
        keeper: p.skills.keeper, defending: p.skills.defending, playmaking: p.skills.playmaking,
        winger: p.skills.winger, passing: p.skills.passing, scoring: p.skills.scoring,
        setpieces: p.skills.setpieces, stamina: p.skills.stamina,
        injuryWeeks: p.injuryWeeks, transferListed: p.transferListed ? 1 : 0,
        valueEstimate, lastMatchRating: p.lastMatchRating, lastMatchDate: p.lastMatchDate,
        updatedAt: new Date().toISOString(),
      };
      store.upsertPlayer(row);
      store.upsertPlayerSnapshot({
        playerId: p.resolvedId, date, tsi: p.tsi, valueEstimate, form: p.form, salary: p.salary,
        injuryWeeks: p.injuryWeeks, lastMatchRating: p.lastMatchRating, lastMatchDate: p.lastMatchDate,
        keeper: p.skills.keeper, defending: p.skills.defending, playmaking: p.skills.playmaking,
        winger: p.skills.winger, passing: p.skills.passing, scoring: p.skills.scoring,
        setpieces: p.skills.setpieces, stamina: p.skills.stamina,
      });
    }

    store.deactivateMissingPlayers(CSV_IMPORT_TEAM_ID, resolved.map((p) => p.resolvedId));
    store.upsertTeamSnapshot({
      date, teamId: CSV_IMPORT_TEAM_ID, teamTsi, teamWorth,
      cash: finances.cash ?? null,
      weeklyIncome: finances.weeklyIncome ?? null,
      weeklyExpenses: finances.weeklyExpenses ?? null,
    });

    setSetting('chpp_team_id', CSV_IMPORT_TEAM_ID);
    setSetting('chpp_team_name', teamName || 'My squad (CSV import)');
    setSetting('data_source', 'csv');
    setSetting('last_sync_at', new Date().toISOString());

    return { teamTsi, teamWorth, playerCount: resolved.length };
  };

  const result = withTransaction(runInTransaction);
  logImport('ok', `${format} format, ${result.playerCount} players, team TSI ${result.teamTsi}`);
  return { ok: true, format, ...result };
}

module.exports = { importSquadCsv, CSV_IMPORT_TEAM_ID };
