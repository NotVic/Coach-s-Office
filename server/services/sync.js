const { db, getSetting, setSetting, withTransaction } = require('../db');
const chpp = require('../chpp/client');
const { parsePlayersXml, parseTeamDetailsXml, parseEconomyXml } = require('../chpp/parse');
const { estimateValue } = require('./valuation');

// CHPP file versions. These have historically stayed stable for years at a
// time, but Hattrick does bump them occasionally — if a sync starts failing
// with a "file/version" style error from CHPP, check
// https://chpp.hattrick.org for the current version and update here.
const FILE_VERSIONS = {
  teamdetails: '3.4',
  players: '2.5',
  economy: '1.4',
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function credentials() {
  return {
    consumerKey: getSetting('chpp_consumer_key') || process.env.CHPP_CONSUMER_KEY || '',
    consumerSecret: getSetting('chpp_consumer_secret') || process.env.CHPP_CONSUMER_SECRET || '',
    accessToken: getSetting('chpp_access_token'),
    accessTokenSecret: getSetting('chpp_access_token_secret'),
  };
}

function logSync(kind, status, message) {
  db.prepare('INSERT INTO sync_log (ran_at, kind, status, message) VALUES (?, ?, ?, ?)')
    .run(new Date().toISOString(), kind, status, message ?? null);
}

const upsertPlayer = db.prepare(`
  INSERT INTO players (
    player_id, team_id, first_name, last_name, nickname, age_years, age_days,
    position_code, specialty, tsi, salary, form, experience, leadership,
    skill_keeper, skill_defending, skill_playmaking, skill_winger, skill_passing,
    skill_scoring, skill_setpieces, skill_stamina, injury_weeks, transfer_listed,
    value_estimate, is_active, updated_at
  ) VALUES (
    @playerId, @teamId, @firstName, @lastName, @nickname, @ageYears, @ageDays,
    @positionCode, @specialty, @tsi, @salary, @form, @experience, @leadership,
    @keeper, @defending, @playmaking, @winger, @passing, @scoring, @setpieces, @stamina,
    @injuryWeeks, @transferListed, @valueEstimate, 1, @updatedAt
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
    is_active = 1, updated_at = excluded.updated_at
`);

const deactivateMissingPlayers = db.prepare(`
  UPDATE players SET is_active = 0 WHERE team_id = ? AND player_id NOT IN (
    SELECT value FROM json_each(?)
  )
`);

const upsertPlayerSnapshot = db.prepare(`
  INSERT INTO player_snapshots (
    player_id, snapshot_date, tsi, value_estimate, form, salary, injury_weeks,
    skill_keeper, skill_defending, skill_playmaking, skill_winger,
    skill_passing, skill_scoring, skill_setpieces, skill_stamina
  ) VALUES (
    @playerId, @date, @tsi, @valueEstimate, @form, @salary, @injuryWeeks,
    @keeper, @defending, @playmaking, @winger, @passing, @scoring, @setpieces, @stamina
  )
  ON CONFLICT(player_id, snapshot_date) DO UPDATE SET
    tsi = excluded.tsi, value_estimate = excluded.value_estimate, form = excluded.form,
    salary = excluded.salary, injury_weeks = excluded.injury_weeks, skill_keeper = excluded.skill_keeper,
    skill_defending = excluded.skill_defending, skill_playmaking = excluded.skill_playmaking,
    skill_winger = excluded.skill_winger, skill_passing = excluded.skill_passing,
    skill_scoring = excluded.skill_scoring, skill_setpieces = excluded.skill_setpieces,
    skill_stamina = excluded.skill_stamina
`);

const upsertTeamSnapshot = db.prepare(`
  INSERT INTO team_snapshots (snapshot_date, team_id, team_tsi, team_worth, cash, weekly_income, weekly_expenses)
  VALUES (@date, @teamId, @teamTsi, @teamWorth, @cash, @weeklyIncome, @weeklyExpenses)
  ON CONFLICT(snapshot_date) DO UPDATE SET
    team_id = excluded.team_id, team_tsi = excluded.team_tsi, team_worth = excluded.team_worth,
    cash = excluded.cash, weekly_income = excluded.weekly_income, weekly_expenses = excluded.weekly_expenses
`);

/**
 * Pulls team + squad (+ finances, best-effort) from CHPP and writes a
 * fresh snapshot. Safe to call repeatedly — everything upserts on the
 * player id / today's date, so a manual "Sync now" the same day just
 * refreshes today's row instead of creating a duplicate.
 */
async function runFullSync({ isInitial = false } = {}) {
  const creds = credentials();
  if (!creds.accessToken) throw new Error('Not connected to CHPP yet.');

  const teamDetailsRaw = await chpp.callChpp({ ...creds, file: 'teamdetails', version: FILE_VERSIONS.teamdetails });
  const teamDetails = parseTeamDetailsXml(teamDetailsRaw);

  const playersRaw = await chpp.callChpp({ ...creds, file: 'players', version: FILE_VERSIONS.players });
  const { team, players } = parsePlayersXml(playersRaw);

  const teamId = team.teamId ?? teamDetails.teamId;
  const teamName = team.teamName ?? teamDetails.teamName;
  const date = today();

  const runInTransaction = () => {
    let teamTsi = 0;
    let teamWorth = 0;

    for (const p of players) {
      const valueEstimate = estimateValue({ tsi: p.tsi, ageYears: p.ageYears, specialtyId: p.specialtyId });
      teamTsi += p.tsi || 0;
      teamWorth += valueEstimate || 0;

      const row = {
        playerId: p.playerId, teamId, firstName: p.firstName, lastName: p.lastName,
        nickname: p.nickname, ageYears: p.ageYears, ageDays: p.ageDays,
        positionCode: p.positionCode, specialty: p.specialty, tsi: p.tsi, salary: p.salary,
        form: p.form, experience: p.experience, leadership: p.leadership,
        keeper: p.skills.keeper, defending: p.skills.defending, playmaking: p.skills.playmaking,
        winger: p.skills.winger, passing: p.skills.passing, scoring: p.skills.scoring,
        setpieces: p.skills.setpieces, stamina: p.skills.stamina,
        injuryWeeks: p.injuryLevel && p.injuryLevel > 0 ? p.injuryLevel : 0,
        transferListed: p.transferListed ? 1 : 0,
        valueEstimate, updatedAt: new Date().toISOString(),
      };
      upsertPlayer.run(row);
      upsertPlayerSnapshot.run({
        playerId: p.playerId, date, tsi: p.tsi, valueEstimate, form: p.form, salary: p.salary,
        injuryWeeks: row.injuryWeeks,
        keeper: p.skills.keeper, defending: p.skills.defending, playmaking: p.skills.playmaking,
        winger: p.skills.winger, passing: p.skills.passing, scoring: p.skills.scoring,
        setpieces: p.skills.setpieces, stamina: p.skills.stamina,
      });
    }

    if (teamId) {
      deactivateMissingPlayers.run(teamId, JSON.stringify(players.map((p) => p.playerId)));
    }

    setSetting('chpp_team_id', teamId);
    setSetting('chpp_team_name', teamName);

    return { teamTsi, teamWorth, playerCount: players.length };
  };

  const { teamTsi, teamWorth, playerCount } = withTransaction(runInTransaction);

  // Finances need an extra CHPP permission scope some apps don't have —
  // don't let that fail the whole sync.
  let cash = null;
  let weeklyIncome = null;
  let weeklyExpenses = null;
  try {
    const economyRaw = await chpp.callChpp({ ...creds, file: 'economy', version: FILE_VERSIONS.economy });
    const economy = parseEconomyXml(economyRaw);
    cash = economy.cash;
    weeklyIncome = economy.weeklyIncome?.total ?? null;
    weeklyExpenses = economy.weeklyCosts?.total ?? null;
  } catch (err) {
    logSync('economy', 'skipped', err.message);
  }

  upsertTeamSnapshot.run({
    date, teamId, teamTsi, teamWorth, cash, weeklyIncome, weeklyExpenses,
  });

  setSetting('last_sync_at', new Date().toISOString());
  logSync(isInitial ? 'initial' : 'scheduled', 'ok', `${playerCount} players, team TSI ${teamTsi}`);

  return { teamId, teamName, playerCount, teamTsi, teamWorth, date };
}

module.exports = { runFullSync, FILE_VERSIONS };
