// Normalizes the raw objects fast-xml-parser produces from CHPP responses
// (see client.js) into the plain shapes the rest of the app works with.
// Field names below are taken from the players.xml / teamDetails.xml /
// economy.xml / matches.xml schemas (cross-checked against the pychpp
// reference client, since the Hattrick wiki blocks automated fetches).

const SPECIALTIES = [
  null, 'Technical', 'Quick', 'Powerful', 'Unpredictable',
  'Head Specialist', 'Regainer', 'Support', 'Resilient',
];

// Hattrick's named skill scale. Levels above 20 are essentially never
// reached by a real player; anything past this list just shows the number.
const SKILL_LEVEL_NAMES = [
  'Non-existent', 'Disastrous', 'Wretched', 'Poor', 'Weak', 'Inadequate',
  'Passable', 'Solid', 'Excellent', 'Formidable', 'Outstanding', 'Brilliant',
  'Magnificent', 'World class', 'Supernatural', 'Titanic', 'Extra-terrestrial',
  'Mythical', 'Magical', 'Utopian', 'Divine',
];

function skillLevelName(level) {
  if (level == null) return null;
  return SKILL_LEVEL_NAMES[level] ?? `Divine+${level - (SKILL_LEVEL_NAMES.length - 1)}`;
}

function num(v, fallback = null) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}

/**
 * Best-effort position line, derived from skill dominance rather than the
 * position a player last happened to be fielded in — that way it still
 * works for reserves and youth-team pull-ups who have no match history.
 * Returns a 4-line bucket (gk/def/mid/att, matching --sb-line-* tokens)
 * plus a 2-3 letter pill code for display (GK/CD/WI/IM/FW).
 */
function derivePositionLine(skills) {
  const keeper = num(skills.keeper, 0);
  const defending = num(skills.defending, 0);
  const playmaking = num(skills.playmaking, 0);
  const winger = num(skills.winger, 0);
  const passing = num(skills.passing, 0);
  const scoring = num(skills.scoring, 0);

  const outfieldBest = Math.max(defending, playmaking, winger, passing, scoring);
  if (keeper >= outfieldBest && keeper > 0) return { line: 'gk', code: 'GK' };

  const midScore = (playmaking + passing) / 2;
  const scores = [
    ['def', 'CD', defending],
    ['mid', 'WI', winger],
    ['mid', 'IM', midScore],
    ['att', 'FW', scoring],
  ];
  scores.sort((a, b) => b[2] - a[2]);
  const [line, code] = scores[0];
  return { line, code };
}

function asArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function parsePlayersXml(root) {
  const team = root.Team ?? {};
  const players = asArray(team.PlayerList?.Player).map((p) => {
    const skillsRaw = p.PlayerSkills ?? {};
    const skills = {
      keeper: num(skillsRaw.KeeperSkill),
      defending: num(skillsRaw.DefenderSkill),
      playmaking: num(skillsRaw.PlaymakerSkill),
      winger: num(skillsRaw.WingerSkill),
      passing: num(skillsRaw.PassingSkill),
      scoring: num(skillsRaw.ScorerSkill),
      setpieces: num(skillsRaw.SetPiecesSkill),
      stamina: num(skillsRaw.StaminaSkill),
    };
    const { line, code } = derivePositionLine(skills);
    return {
      playerId: num(p.PlayerID),
      firstName: p.FirstName ?? '',
      lastName: p.LastName ?? '',
      nickname: p.NickName ?? '',
      ageYears: num(p.Age),
      ageDays: num(p.AgeDays),
      tsi: num(p.TSI),
      salary: num(p.Salary),
      form: num(p.PlayerForm),
      experience: num(p.Experience),
      leadership: num(p.Leadership),
      specialtyId: num(p.Specialty, 0),
      specialty: SPECIALTIES[num(p.Specialty, 0)] ?? null,
      injuryLevel: num(p.InjuryLevel, 0), // -1 = uninjured per CHPP convention; weeks remaining otherwise
      transferListed: num(p.TransferListed, 0) === 1,
      statement: p.Statement || null,
      skills,
      positionLine: line,
      positionCode: code,
    };
  });

  return {
    team: { teamId: num(team.TeamID), teamName: team.TeamName ?? null },
    players,
  };
}

function parseTeamDetailsXml(root) {
  const team = root.Team ?? {};
  return {
    teamId: num(team.TeamID),
    teamName: team.TeamName ?? null,
    league: { id: num(team.League?.LeagueID), name: team.League?.LeagueName ?? null },
    leagueLevelUnit: {
      id: num(team.LeagueLevelUnitID ?? team.LeagueLevelUnit?.LeagueLevelUnitID),
      name: team.LeagueLevelUnitName ?? team.LeagueLevelUnit?.LeagueLevelUnitName ?? null,
    },
    arena: { id: num(team.Arena?.ArenaID), name: team.Arena?.ArenaName ?? null },
    powerRating: num(team.PowerRating?.PowerRating ?? team.PowerRating?.value),
    nextMatch: parseMaybeMatchStub(team.NextMatch),
  };
}

function parseMaybeMatchStub(node) {
  if (!node) return null;
  const matchId = num(node.MatchID ?? node.LastMatchId ?? node.NextMatchId);
  if (!matchId) return null;
  return { matchId, date: node.MatchDate ?? null };
}

function parseEconomyXml(root) {
  const team = root.Team ?? {};
  return {
    teamId: num(team.TeamID ?? team.id),
    cash: num(team.Cash),
    weeklyIncome: {
      spectators: num(team.IncomeSpectators),
      sponsors: num(team.IncomeSponsors),
      commercial: num(team.IncomeFinances ?? team.IncomeFinancial),
      soldPlayers: num(team.IncomeSoldPlayers),
      total: num(team.IncomeSum ?? team.IncomeTotal),
    },
    weeklyCosts: {
      arena: num(team.CostsArena),
      players: num(team.CostsPlayers),
      staff: num(team.CostsStaff),
      boughtPlayers: num(team.CostsBoughtPlayers),
      total: num(team.CostsSum ?? team.CostsTotal),
    },
  };
}

function parseMatchesXml(root) {
  const team = root.Team ?? {};
  const matches = asArray(team.MatchList?.Match).map((m) => ({
    matchId: num(m.MatchID),
    date: m.MatchDate ?? null,
    matchType: num(m.MatchType),
    status: m.Status ?? null,
    homeTeam: { id: num(m.HomeTeam?.HomeTeamID ?? m.HomeTeamID), name: m.HomeTeam?.HomeTeamName ?? m.HomeTeamName ?? null },
    awayTeam: { id: num(m.AwayTeam?.AwayTeamID ?? m.AwayTeamID), name: m.AwayTeam?.AwayTeamName ?? m.AwayTeamName ?? null },
    homeGoals: num(m.HomeTeam?.HomeGoals ?? m.HomeGoals),
    awayGoals: num(m.AwayTeam?.AwayGoals ?? m.AwayGoals),
  }));
  return { teamId: num(team.TeamID), matches };
}

module.exports = {
  SPECIALTIES,
  skillLevelName,
  derivePositionLine,
  parsePlayersXml,
  parseTeamDetailsXml,
  parseEconomyXml,
  parseMatchesXml,
};
