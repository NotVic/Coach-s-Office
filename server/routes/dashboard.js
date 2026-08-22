const express = require('express');
const { db, getSetting } = require('../db');

const router = express.Router();

function lineOf(positionCode) {
  if (positionCode === 'GK') return 'gk';
  if (['CD', 'WB'].includes(positionCode)) return 'def';
  if (['IM', 'WI'].includes(positionCode)) return 'mid';
  return 'att';
}

function toPlayerSummary(p) {
  return {
    playerId: p.player_id,
    name: `${p.first_name} ${p.last_name}`.trim(),
    ageYears: p.age_years,
    positionCode: p.position_code,
    tsi: p.tsi,
    valueEstimate: p.value_estimate,
    form: p.form,
    specialty: p.specialty,
    injuryWeeks: p.injury_weeks,
    transferListed: Boolean(p.transfer_listed),
  };
}

router.get('/', (req, res) => {
  const teamId = Number(getSetting('chpp_team_id'));
  if (!teamId) return res.json({ connected: false });

  const snapshots = db.prepare(
    `SELECT snapshot_date, team_tsi, team_worth, cash, weekly_income, weekly_expenses
     FROM team_snapshots WHERE team_id = ? ORDER BY snapshot_date ASC`
  ).all(teamId);

  const players = db.prepare(
    'SELECT * FROM players WHERE team_id = ? AND is_active = 1 ORDER BY tsi DESC'
  ).all(teamId);

  const ageDistribution = {};
  for (const p of players) {
    const bucket = p.age_years == null ? 'Unknown' : String(p.age_years);
    ageDistribution[bucket] = (ageDistribution[bucket] || 0) + 1;
  }

  const positionComposition = { gk: 0, def: 0, mid: 0, att: 0 };
  for (const p of players) positionComposition[lineOf(p.position_code)] += 1;

  res.json({
    connected: true,
    teamId,
    teamName: getSetting('chpp_team_name'),
    lastSyncAt: getSetting('last_sync_at'),
    snapshots,
    latest: snapshots[snapshots.length - 1] || null,
    previous: snapshots.length > 1 ? snapshots[snapshots.length - 2] : null,
    ageDistribution,
    positionComposition,
    players: players.map(toPlayerSummary),
  });
});

module.exports = router;
