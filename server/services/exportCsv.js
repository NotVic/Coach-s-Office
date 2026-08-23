// Exports the currently active squad (however it got here — CHPP sync or a
// previous CSV import, see services/store.js) in the exact same column
// shape services/importCsv.js accepts. That symmetry is deliberate: the
// "download template" button and the "export" button both go through this
// file, so there's never a second, drifting definition of the format.
const { db, getSetting } = require('../db');
const { buildCsv } = require('../lib/csv');
const { COLUMNS, playerRowToCsvRecord, templateExampleRecord } = require('./csvSchema');

function exportSquadCsv() {
  const teamId = Number(getSetting('chpp_team_id'));
  if (!teamId) return null;
  const players = db.prepare(
    'SELECT * FROM players WHERE team_id = ? AND is_active = 1 ORDER BY tsi DESC'
  ).all(teamId);
  return buildCsv(COLUMNS, players.map(playerRowToCsvRecord));
}

function templateCsv() {
  return buildCsv(COLUMNS, [templateExampleRecord()]);
}

module.exports = { exportSquadCsv, templateCsv };
