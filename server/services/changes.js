// Reconciles the two most recent snapshots for a team so both the weekly
// digest and the dashboard's "Needs attention" panel always reflect what
// actually happened, rather than a stale projection (Hattrick's own
// training page has been criticized for exactly that — not refreshing
// cleanly after training occurs).
const { db } = require('../db');

const SKILL_KEYS = [
  'skill_keeper', 'skill_defending', 'skill_playmaking', 'skill_winger',
  'skill_passing', 'skill_scoring', 'skill_setpieces', 'skill_stamina',
];
const SKILL_LABELS = {
  skill_keeper: 'Keeper', skill_defending: 'Defending', skill_playmaking: 'Playmaking',
  skill_winger: 'Winger', skill_passing: 'Passing', skill_scoring: 'Scoring',
  skill_setpieces: 'Set pieces', skill_stamina: 'Stamina',
};

/** Diffs the two most recent snapshot dates for a team. Returns { ready: false, reason } if there isn't enough history yet. */
function computeRecentChanges(teamId) {
  const dates = db.prepare(
    'SELECT DISTINCT snapshot_date FROM team_snapshots WHERE team_id = ? ORDER BY snapshot_date DESC LIMIT 2'
  ).all(teamId).map((r) => r.snapshot_date);

  if (dates.length < 2) {
    return { ready: false, reason: 'not_enough_history', syncCount: dates.length };
  }
  const [currentDate, previousDate] = dates;

  const teamCurrent = db.prepare('SELECT * FROM team_snapshots WHERE team_id = ? AND snapshot_date = ?').get(teamId, currentDate);
  const teamPrevious = db.prepare('SELECT * FROM team_snapshots WHERE team_id = ? AND snapshot_date = ?').get(teamId, previousDate);

  const currentPlayerSnaps = db.prepare(
    `SELECT ps.*, p.first_name, p.last_name FROM player_snapshots ps
     JOIN players p ON p.player_id = ps.player_id
     WHERE ps.snapshot_date = ? AND p.team_id = ?`
  ).all(currentDate, teamId);
  const previousPlayerSnaps = db.prepare('SELECT * FROM player_snapshots WHERE snapshot_date = ?').all(previousDate);
  const prevById = new Map(previousPlayerSnaps.map((s) => [s.player_id, s]));

  const levelUps = [];
  const newInjuries = [];
  const recovered = [];
  const valueMovers = [];

  for (const cur of currentPlayerSnaps) {
    const prev = prevById.get(cur.player_id);
    if (!prev) continue; // new to the squad since last sync — nothing to diff against
    const name = `${cur.first_name} ${cur.last_name}`.trim();

    for (const key of SKILL_KEYS) {
      if (cur[key] != null && prev[key] != null && cur[key] > prev[key]) {
        levelUps.push({ playerId: cur.player_id, name, skill: SKILL_LABELS[key], from: prev[key], to: cur[key] });
      }
    }
    if ((cur.injury_weeks || 0) > 0 && (prev.injury_weeks || 0) === 0) {
      newInjuries.push({ playerId: cur.player_id, name, weeks: cur.injury_weeks });
    }
    if ((cur.injury_weeks || 0) === 0 && (prev.injury_weeks || 0) > 0) {
      recovered.push({ playerId: cur.player_id, name });
    }
    const valueDelta = (cur.value_estimate ?? 0) - (prev.value_estimate ?? 0);
    if (valueDelta !== 0) {
      valueMovers.push({ playerId: cur.player_id, name, delta: valueDelta, from: prev.value_estimate, to: cur.value_estimate });
    }
  }

  valueMovers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    ready: true,
    currentDate,
    previousDate,
    team: {
      tsiDelta: (teamCurrent.team_tsi ?? 0) - (teamPrevious.team_tsi ?? 0),
      worthDelta: (teamCurrent.team_worth ?? 0) - (teamPrevious.team_worth ?? 0),
      cashDelta: teamCurrent.cash != null && teamPrevious.cash != null ? teamCurrent.cash - teamPrevious.cash : null,
    },
    levelUps,
    newInjuries,
    recovered,
    valueMovers,
  };
}

/**
 * The dashboard's persistent "Needs attention" panel: currently-injured
 * players, this week's level-ups (worth a lineup/wage review), and players
 * whose estimated value just started falling (often an age-related signal
 * — a possible sell-before-it-drops-further window). Hattrick players
 * don't have contracts (only staff do), so there's no "contract expiring"
 * item here — see README.
 */
function buildNeedsAttention(teamId, activePlayers) {
  const injured = activePlayers
    .filter((p) => p.injury_weeks > 0)
    .map((p) => ({ playerId: p.player_id, name: `${p.first_name} ${p.last_name}`.trim(), weeks: p.injury_weeks }));

  const changes = computeRecentChanges(teamId);
  if (!changes.ready) {
    return { injured, levelUps: [], fallingValue: [], hasRecentChanges: false };
  }

  const fallingValue = changes.valueMovers.filter((m) => m.delta < 0).slice(0, 5);

  return {
    injured,
    levelUps: changes.levelUps,
    fallingValue,
    hasRecentChanges: true,
  };
}

module.exports = { computeRecentChanges, buildNeedsAttention };
