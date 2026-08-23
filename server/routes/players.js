const express = require('express');
const { db } = require('../db');
const { estimateValueRange } = require('../services/valuation');
const { estimateTrainingEta } = require('../services/training');
const { skillLevelName } = require('../chpp/parse');

const router = express.Router();

const SKILL_KEYS = [
  'skill_keeper', 'skill_defending', 'skill_playmaking', 'skill_winger',
  'skill_passing', 'skill_scoring', 'skill_setpieces', 'skill_stamina',
];
const SKILL_LABELS = {
  skill_keeper: 'Keeper', skill_defending: 'Defending', skill_playmaking: 'Playmaking',
  skill_winger: 'Winger', skill_passing: 'Passing', skill_scoring: 'Scoring',
  skill_setpieces: 'Set pieces', skill_stamina: 'Stamina',
};

router.get('/:id', (req, res) => {
  const playerId = Number(req.params.id);
  const player = db.prepare('SELECT * FROM players WHERE player_id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Player not found.' });

  const teamSnapshot = player.team_id
    ? db.prepare('SELECT weekly_income FROM team_snapshots WHERE team_id = ? ORDER BY snapshot_date DESC LIMIT 1').get(player.team_id)
    : null;

  const snapshots = db.prepare(
    'SELECT * FROM player_snapshots WHERE player_id = ? ORDER BY snapshot_date ASC'
  ).all(playerId);

  const skills = SKILL_KEYS.map((key) => ({
    key,
    label: SKILL_LABELS[key],
    level: player[key],
    levelName: skillLevelName(player[key]),
    eta: estimateTrainingEta(snapshots, key),
  }));

  // Hattrick trains one club-wide skill at a time, but CHPP doesn't expose
  // which one directly — infer it as whichever skill gained the most over
  // the tracked window (see services/training.js) so the UI can highlight
  // it in the skill-meter list.
  const gain = (key) => (snapshots.at(-1)?.[key] ?? 0) - (snapshots[0]?.[key] ?? 0);
  const trainedSkillKey = snapshots.length >= 2
    ? skills.reduce((best, s) => (gain(s.key) > gain(best.key) ? s : best), skills[0]).key
    : null;

  res.json({
    player: {
      playerId: player.player_id,
      name: `${player.first_name} ${player.last_name}`.trim(),
      nickname: player.nickname,
      ageYears: player.age_years,
      ageDays: player.age_days,
      positionCode: player.position_code,
      specialty: player.specialty,
      tsi: player.tsi,
      salary: player.salary,
      form: player.form,
      injuryWeeks: player.injury_weeks,
      transferListed: Boolean(player.transfer_listed),
      valueEstimate: player.value_estimate,
      valueRange: estimateValueRange({ tsi: player.tsi, ageYears: player.age_years, specialtyId: null }),
      // Wage in context, not a contract countdown — Hattrick players don't
      // have contracts (only staff do), so there's nothing to count down.
      salaryShareOfWeeklyIncome: teamSnapshot?.weekly_income
        ? Math.round((player.salary / teamSnapshot.weekly_income) * 1000) / 10
        : null,
    },
    skills,
    trainedSkillKey,
    tsiHistory: snapshots.map((s) => ({ date: s.snapshot_date, tsi: s.tsi })),
    valueHistory: snapshots.map((s) => ({ date: s.snapshot_date, value: s.value_estimate })),
    formHistory: snapshots.map((s) => ({ date: s.snapshot_date, form: s.form })),
    // Sampled once per sync (whatever CHPP reports as the player's most
    // recent match at that time), not a full match-by-match log — CHPP
    // only exposes the single latest match per player, so this is a trend
    // built from repeated snapshots, not a per-fixture history.
    ratingHistory: snapshots
      .filter((s) => s.last_match_rating != null)
      .map((s) => ({ date: s.last_match_date || s.snapshot_date, rating: s.last_match_rating })),
  });
});

module.exports = router;
