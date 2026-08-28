const { db, getSetting, setSetting, deleteSetting, withTransaction } = require('../db');
const chpp = require('../chpp/client');
const { parsePlayersXml, parseTeamDetailsXml, parseEconomyXml, parseTrainingXml, skillLevelName } = require('../chpp/parse');
const { estimateValue } = require('./valuation');
const store = require('./store');

// CHPP file versions. These have historically stayed stable for years at a
// time, but Hattrick does bump them occasionally — if a sync starts failing
// with a "file/version" style error from CHPP, check
// https://chpp.hattrick.org for the current version and update here.
const FILE_VERSIONS = {
  teamdetails: '3.4',
  players: '2.5',
  economy: '1.4',
  training: '2.2',
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
        valueEstimate,
        lastMatchRating: p.lastMatch?.rating ?? null,
        lastMatchDate: p.lastMatch?.date ?? null,
        updatedAt: new Date().toISOString(),
      };
      store.upsertPlayer(row);
      store.upsertPlayerSnapshot({
        playerId: p.playerId, date, tsi: p.tsi, valueEstimate, form: p.form, salary: p.salary,
        injuryWeeks: row.injuryWeeks,
        lastMatchRating: row.lastMatchRating, lastMatchDate: row.lastMatchDate,
        keeper: p.skills.keeper, defending: p.skills.defending, playmaking: p.skills.playmaking,
        winger: p.skills.winger, passing: p.skills.passing, scoring: p.skills.scoring,
        setpieces: p.skills.setpieces, stamina: p.skills.stamina,
      });
    }

    if (teamId) {
      store.deactivateMissingPlayers(teamId, players.map((p) => p.playerId));
    }

    setSetting('chpp_team_id', teamId);
    setSetting('chpp_team_name', teamName);
    setSetting('data_source', 'chpp');

    return { teamTsi, teamWorth, playerCount: players.length };
  };

  const { teamTsi, teamWorth, playerCount } = withTransaction(runInTransaction);

  // The coach is a player on your own roster; TrainerData on that player is
  // how CHPP exposes their trainer skill. Best-effort context for the
  // training banner — never required for the sync to succeed.
  const coach = players.find((p) => p.trainerData);
  if (coach) {
    setSetting('coach_name', `${coach.firstName} ${coach.lastName}`.trim());
    setSetting('coach_skill_level', coach.trainerData.skillLevel);
    setSetting('coach_skill_name', skillLevelName(coach.trainerData.skillLevel));
  }

  // Current training settings (file=training). Best-effort like economy —
  // a scope/version problem here must never fail the whole sync.
  try {
    const trainingRaw = await chpp.callChpp({ ...creds, file: 'training', version: FILE_VERSIONS.training });
    const training = parseTrainingXml(trainingRaw);
    if (training.skillKey) {
      // Only move the focus-change date when the trained skill actually
      // changed — over successive syncs this makes training_focus_set_at a
      // true "when the focus last changed" date, which is what the
      // ETA window segmentation in services/training.js needs.
      if (getSetting('training_focus_skill') !== training.skillKey) {
        setSetting('training_focus_set_at', new Date().toISOString());
      }
      setSetting('training_focus_skill', training.skillKey);
      setSetting('training_focus_type_label', training.trainingTypeLabel);
      setSetting('training_focus_intensity_pct', training.intensityPct);
      setSetting('training_focus_stamina_pct', training.staminaPct);
      setSetting('training_focus_source', 'chpp');
    } else if (training.trainingTypeId != null) {
      // A type id this app doesn't recognize (new Hattrick training type?):
      // clear rather than keep a stale skill, and log it for diagnosis.
      ['training_focus_skill', 'training_focus_type_label', 'training_focus_intensity_pct',
        'training_focus_stamina_pct', 'training_focus_set_at', 'training_focus_source'].forEach(deleteSetting);
      logSync('training', 'skipped', `Unrecognized TrainingType id ${training.trainingTypeId} — update TRAINING_TYPES in server/chpp/parse.js`);
    }
  } catch (err) {
    logSync('training', 'skipped', err.message);
  }

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

  store.upsertTeamSnapshot({
    date, teamId, teamTsi, teamWorth, cash, weeklyIncome, weeklyExpenses,
  });

  setSetting('last_sync_at', new Date().toISOString());
  logSync(isInitial ? 'initial' : 'scheduled', 'ok', `${playerCount} players, team TSI ${teamTsi}`);

  return { teamId, teamName, playerCount, teamTsi, teamWorth, date };
}

module.exports = { runFullSync, FILE_VERSIONS };
