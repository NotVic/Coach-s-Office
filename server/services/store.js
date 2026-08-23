// Shared write layer for players / player_snapshots / team_snapshots.
// Both the CHPP sync (services/sync.js) and the CSV import
// (services/importCsv.js) write into the exact same tables through these
// functions, so every other route (dashboard, player detail, digest)
// works identically regardless of where the data came from.
const { db } = require('../db');

const upsertPlayerStmt = db.prepare(`
  INSERT INTO players (
    player_id, team_id, first_name, last_name, nickname, age_years, age_days,
    position_code, specialty, tsi, salary, form, experience, leadership,
    skill_keeper, skill_defending, skill_playmaking, skill_winger, skill_passing,
    skill_scoring, skill_setpieces, skill_stamina, injury_weeks, transfer_listed,
    value_estimate, last_match_rating, last_match_date, is_active, updated_at
  ) VALUES (
    @playerId, @teamId, @firstName, @lastName, @nickname, @ageYears, @ageDays,
    @positionCode, @specialty, @tsi, @salary, @form, @experience, @leadership,
    @keeper, @defending, @playmaking, @winger, @passing, @scoring, @setpieces, @stamina,
    @injuryWeeks, @transferListed, @valueEstimate, @lastMatchRating, @lastMatchDate, 1, @updatedAt
  )
  ON CONFLICT(player_id) DO UPDATE SET
    team_id = excluded.team_id, first_name = excluded.first_name, last_name = excluded.last_name,
    nickname = excluded.nickname, age_years = excluded.age_years, age_days = excluded.age_days,
    position_code = excluded.position_code, specialty = excluded.specialty, tsi = excluded.tsi,
    salary = excluded.salary, form = excluded.form, experience = excluded.experience,
    leadership = excluded.leadership, skill_keeper = excluded.skill_keeper,
    skill_defending = excluded.skill_defending, skill_playmaking = excluded.skill_playmaking,
    skill_winger = excluded.skill_winger, skill_passing = excluded.skill_passing,
    skill_scoring = excluded.skill_scoring, skill_setpieces = excluded.skill_setpieces,
    skill_stamina = excluded.skill_stamina, injury_weeks = excluded.injury_weeks,
    transfer_listed = excluded.transfer_listed, value_estimate = excluded.value_estimate,
    last_match_rating = excluded.last_match_rating, last_match_date = excluded.last_match_date,
    is_active = 1, updated_at = excluded.updated_at
`);

const deactivateMissingPlayersStmt = db.prepare(`
  UPDATE players SET is_active = 0 WHERE team_id = ? AND player_id NOT IN (
    SELECT value FROM json_each(?)
  )
`);

const upsertPlayerSnapshotStmt = db.prepare(`
  INSERT INTO player_snapshots (
    player_id, snapshot_date, tsi, value_estimate, form, salary, injury_weeks,
    last_match_rating, last_match_date,
    skill_keeper, skill_defending, skill_playmaking, skill_winger,
    skill_passing, skill_scoring, skill_setpieces, skill_stamina
  ) VALUES (
    @playerId, @date, @tsi, @valueEstimate, @form, @salary, @injuryWeeks,
    @lastMatchRating, @lastMatchDate,
    @keeper, @defending, @playmaking, @winger, @passing, @scoring, @setpieces, @stamina
  )
  ON CONFLICT(player_id, snapshot_date) DO UPDATE SET
    tsi = excluded.tsi, value_estimate = excluded.value_estimate, form = excluded.form,
    salary = excluded.salary, injury_weeks = excluded.injury_weeks,
    last_match_rating = excluded.last_match_rating, last_match_date = excluded.last_match_date,
    skill_keeper = excluded.skill_keeper,
    skill_defending = excluded.skill_defending, skill_playmaking = excluded.skill_playmaking,
    skill_winger = excluded.skill_winger, skill_passing = excluded.skill_passing,
    skill_scoring = excluded.skill_scoring, skill_setpieces = excluded.skill_setpieces,
    skill_stamina = excluded.skill_stamina
`);

const upsertTeamSnapshotStmt = db.prepare(`
  INSERT INTO team_snapshots (snapshot_date, team_id, team_tsi, team_worth, cash, weekly_income, weekly_expenses)
  VALUES (@date, @teamId, @teamTsi, @teamWorth, @cash, @weeklyIncome, @weeklyExpenses)
  ON CONFLICT(snapshot_date) DO UPDATE SET
    team_id = excluded.team_id, team_tsi = excluded.team_tsi, team_worth = excluded.team_worth,
    cash = excluded.cash, weekly_income = excluded.weekly_income, weekly_expenses = excluded.weekly_expenses
`);

function upsertPlayer(row) { upsertPlayerStmt.run(row); }
function upsertPlayerSnapshot(row) { upsertPlayerSnapshotStmt.run(row); }
function upsertTeamSnapshot(row) { upsertTeamSnapshotStmt.run(row); }
function deactivateMissingPlayers(teamId, keepPlayerIds) {
  deactivateMissingPlayersStmt.run(teamId, JSON.stringify(keepPlayerIds));
}

module.exports = { upsertPlayer, upsertPlayerSnapshot, upsertTeamSnapshot, deactivateMissingPlayers };
