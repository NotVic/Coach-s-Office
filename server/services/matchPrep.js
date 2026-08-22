// Next-match prep. Scoped to what CHPP actually exposes for a team that
// isn't yours: teamdetails (public — name, league, arena, PowerRating) and
// players' TSI (visible league-wide in the game itself). Detailed skill
// numbers for an opponent are NOT available via CHPP unless you've scouted
// them in-game, so this deliberately does not fabricate an opponent skill
// breakdown or a sector-by-sector rating comparison — it compares the one
// real, apples-to-apples number both teams expose: total squad TSI.
const chpp = require('../chpp/client');
const { parseTeamDetailsXml, parsePlayersXml, parseMatchesXml } = require('../chpp/parse');
const { db, getSetting } = require('../db');
const { FILE_VERSIONS } = require('./sync');

function credentials() {
  return {
    consumerKey: getSetting('chpp_consumer_key') || process.env.CHPP_CONSUMER_KEY || '',
    consumerSecret: getSetting('chpp_consumer_secret') || process.env.CHPP_CONSUMER_SECRET || '',
    accessToken: getSetting('chpp_access_token'),
    accessTokenSecret: getSetting('chpp_access_token_secret'),
  };
}

/** A team-TSI comparison only — deliberately never presented as a confident score prediction. */
function estimateMatchOutcome(ownTsi, opponentTsi) {
  if (!ownTsi || !opponentTsi) return null;
  const strength = ownTsi / (ownTsi + opponentTsi); // 0..1, 0.5 = evenly matched
  const evenness = 1 - Math.abs(strength - 0.5) * 2; // 1 = even, 0 = lopsided
  const drawPct = Math.round(18 + evenness * 14);
  const winPct = Math.round((100 - drawPct) * strength);
  const lossPct = 100 - drawPct - winPct;
  return { winPct, drawPct, lossPct };
}

const LINE_SLOTS = { def: 4, mid: 4, att: 2 }; // simple 4-4-2 template

/** Best-effort suggested XI from your own squad's skills — not a tactics engine. */
function suggestLineup(players) {
  const fit = players.filter((p) => p.is_active && !p.injury_weeks);
  const byLine = { gk: [], def: [], mid: [], att: [] };
  for (const p of fit) {
    const line = p.position_code === 'GK' ? 'gk'
      : ['CD', 'WB'].includes(p.position_code) ? 'def'
      : ['IM', 'WI'].includes(p.position_code) ? 'mid'
      : 'att';
    byLine[line].push(p);
  }
  const rank = (list, key) => [...list].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));

  const gk = rank(byLine.gk, 'skill_keeper').slice(0, 1);
  const def = rank(byLine.def, 'skill_defending').slice(0, LINE_SLOTS.def);
  const mid = rank(byLine.mid, 'skill_playmaking').slice(0, LINE_SLOTS.mid);
  const att = rank(byLine.att, 'skill_scoring').slice(0, LINE_SLOTS.att);

  const chosenIds = new Set([...gk, ...def, ...mid, ...att].map((p) => p.player_id));
  const shortfall = 1 + LINE_SLOTS.def + LINE_SLOTS.mid + LINE_SLOTS.att - chosenIds.size;
  let fillers = [];
  if (shortfall > 0) {
    fillers = rank(fit.filter((p) => !chosenIds.has(p.player_id)), 'tsi').slice(0, shortfall);
  }

  return { formation: '4-4-2', gk, def, mid, att, fillers };
}

async function getNextMatch(creds, ownTeamId) {
  const matchesRaw = await chpp.callChpp({ ...creds, file: 'matches', version: '2.3' });
  const { matches } = parseMatchesXml(matchesRaw);
  const now = Date.now();
  const upcoming = matches
    .filter((m) => m.date && new Date(m.date).getTime() > now && m.homeGoals == null)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!upcoming.length) return null;
  const m = upcoming[0];
  const opponent = m.homeTeam.id === ownTeamId ? m.awayTeam : m.homeTeam;
  const isHome = m.homeTeam.id === ownTeamId;
  return { ...m, opponent, isHome };
}

async function buildMatchPrep() {
  const creds = credentials();
  if (!creds.accessToken) throw new Error('Not connected to CHPP yet.');
  const ownTeamId = Number(getSetting('chpp_team_id'));

  const next = await getNextMatch(creds, ownTeamId);
  if (!next) return { hasMatch: false };

  const [opponentDetailsRaw, opponentPlayersRaw] = await Promise.all([
    chpp.callChpp({ ...creds, file: 'teamdetails', version: FILE_VERSIONS.teamdetails, params: { teamID: next.opponent.id } }),
    chpp.callChpp({ ...creds, file: 'players', version: FILE_VERSIONS.players, params: { teamID: next.opponent.id } })
      .catch(() => null), // some opponents' squads aren't viewable — degrade gracefully
  ]);
  const opponentDetails = parseTeamDetailsXml(opponentDetailsRaw);
  const opponentTsi = opponentPlayersRaw
    ? parsePlayersXml(opponentPlayersRaw).players.reduce((sum, p) => sum + (p.tsi || 0), 0)
    : null;

  const latestSnapshot = db.prepare(
    'SELECT team_tsi FROM team_snapshots ORDER BY snapshot_date DESC LIMIT 1'
  ).get();
  const ownTsi = latestSnapshot?.team_tsi ?? null;

  const players = db.prepare('SELECT * FROM players WHERE team_id = ? AND is_active = 1').all(ownTeamId);
  const lineup = suggestLineup(players);
  const availability = players.filter((p) => p.injury_weeks > 0);

  return {
    hasMatch: true,
    match: { matchId: next.matchId, date: next.date, isHome: next.isHome },
    opponent: {
      teamId: next.opponent.id,
      name: opponentDetails.teamName ?? next.opponent.name,
      league: opponentDetails.league,
      arena: opponentDetails.arena,
      powerRating: opponentDetails.powerRating,
      tsi: opponentTsi,
      tsiAvailable: opponentTsi != null,
    },
    ownTsi,
    outcomeEstimate: estimateMatchOutcome(ownTsi, opponentTsi),
    lineup,
    availability: availability.map((p) => ({
      playerId: p.player_id, name: `${p.first_name} ${p.last_name}`.trim(), injuryWeeks: p.injury_weeks,
    })),
  };
}

module.exports = { buildMatchPrep, estimateMatchOutcome, suggestLineup };
