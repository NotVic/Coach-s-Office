// Next-match prep. Scoped to what CHPP actually exposes for a team that
// isn't yours: teamdetails (public — name, league, arena, PowerRating) and
// players' TSI (visible league-wide in the game itself). Detailed skill
// numbers for an opponent are NOT available via CHPP unless you've scouted
// them in-game, so this deliberately does not fabricate an opponent skill
// breakdown or a sector-by-sector rating comparison — it compares the one
// real, apples-to-apples number both teams expose: total squad TSI.
const chpp = require('../chpp/client');
const { parseTeamDetailsXml, parsePlayersXml, parseMatchesXml } = require('../chpp/parse');
const { db, getSetting, setSetting, deleteSetting } = require('../db');
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

function ownSquadContext() {
  const ownTeamId = Number(getSetting('chpp_team_id'));
  const latestSnapshot = db.prepare(
    'SELECT team_tsi FROM team_snapshots ORDER BY snapshot_date DESC LIMIT 1'
  ).get();
  const players = ownTeamId
    ? db.prepare('SELECT * FROM players WHERE team_id = ? AND is_active = 1').all(ownTeamId)
    : [];
  return {
    ownTeamId,
    ownTsi: latestSnapshot?.team_tsi ?? null,
    lineup: suggestLineup(players),
    availability: players.filter((p) => p.injury_weeks > 0).map((p) => ({
      playerId: p.player_id, name: `${p.first_name} ${p.last_name}`.trim(), injuryWeeks: p.injury_weeks,
    })),
    hasSquad: players.length > 0,
  };
}

// ---- Manual fixture (no CHPP keys yet) --------------------------------
// Everything on the match-prep page that CHPP would normally provide about
// the fixture itself — opponent, date, venue, their total TSI — can be
// read straight off hattrick.org and typed in. The suggested XI and the
// availability panel come from your own imported squad either way.

const MANUAL_KEYS = ['manual_next_match_opponent', 'manual_next_match_date', 'manual_next_match_is_home', 'manual_next_match_opponent_tsi', 'manual_next_match_set_at'];

function saveManualFixture({ opponentName, date, isHome, opponentTsi }) {
  setSetting('manual_next_match_opponent', opponentName);
  setSetting('manual_next_match_date', date);
  setSetting('manual_next_match_is_home', isHome ? '1' : '0');
  setSetting('manual_next_match_opponent_tsi', opponentTsi ?? null);
  setSetting('manual_next_match_set_at', new Date().toISOString());
}

function clearManualFixture() {
  MANUAL_KEYS.forEach(deleteSetting);
}

function getManualFixture() {
  const opponentName = getSetting('manual_next_match_opponent');
  if (!opponentName) return null;
  const tsiRaw = getSetting('manual_next_match_opponent_tsi');
  return {
    opponentName,
    date: getSetting('manual_next_match_date'),
    isHome: getSetting('manual_next_match_is_home') === '1',
    opponentTsi: tsiRaw != null && tsiRaw !== '' ? Number(tsiRaw) : null,
    setAt: getSetting('manual_next_match_set_at'),
  };
}

function buildFromManual() {
  const squad = ownSquadContext();
  const fixture = getManualFixture();
  if (!fixture) {
    return { hasMatch: false, source: 'manual', connected: false, hasSquad: squad.hasSquad };
  }
  // A fixture more than half a day in the past has been played — prompt for
  // the next one instead of prepping a match that's already over.
  const expired = fixture.date && (Date.now() - new Date(fixture.date).getTime()) > 12 * 60 * 60 * 1000;
  if (expired) {
    return { hasMatch: false, source: 'manual', connected: false, hasSquad: squad.hasSquad, expiredFixture: fixture };
  }

  return {
    hasMatch: true,
    source: 'manual',
    connected: false,
    match: { matchId: null, date: fixture.date, isHome: fixture.isHome },
    opponent: {
      teamId: null,
      name: fixture.opponentName,
      league: null,
      arena: null,
      powerRating: null,
      tsi: fixture.opponentTsi,
      tsiAvailable: fixture.opponentTsi != null,
    },
    ownTsi: squad.ownTsi,
    outcomeEstimate: estimateMatchOutcome(squad.ownTsi, fixture.opponentTsi),
    lineup: squad.lineup,
    availability: squad.availability,
    fixtureSetAt: fixture.setAt,
  };
}

async function buildMatchPrep() {
  const creds = credentials();
  // No CHPP connection: fall back to the manually-entered fixture.
  if (!creds.accessToken) return buildFromManual();
  const ownTeamId = Number(getSetting('chpp_team_id'));

  const next = await getNextMatch(creds, ownTeamId);
  if (!next) return { hasMatch: false, source: 'chpp', connected: true };

  const [opponentDetailsRaw, opponentPlayersRaw] = await Promise.all([
    chpp.callChpp({ ...creds, file: 'teamdetails', version: FILE_VERSIONS.teamdetails, params: { teamID: next.opponent.id } }),
    chpp.callChpp({ ...creds, file: 'players', version: FILE_VERSIONS.players, params: { teamID: next.opponent.id } })
      .catch(() => null), // some opponents' squads aren't viewable — degrade gracefully
  ]);
  const opponentDetails = parseTeamDetailsXml(opponentDetailsRaw);
  const opponentTsi = opponentPlayersRaw
    ? parsePlayersXml(opponentPlayersRaw).players.reduce((sum, p) => sum + (p.tsi || 0), 0)
    : null;

  const squad = ownSquadContext();

  return {
    hasMatch: true,
    source: 'chpp',
    connected: true,
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
    ownTsi: squad.ownTsi,
    outcomeEstimate: estimateMatchOutcome(squad.ownTsi, opponentTsi),
    lineup: squad.lineup,
    availability: squad.availability,
  };
}

module.exports = { buildMatchPrep, saveManualFixture, clearManualFixture, estimateMatchOutcome, suggestLineup };
