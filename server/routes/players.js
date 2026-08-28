const express = require('express');
const { db, getSetting } = require('../db');
const { estimateValueRange } = require('../services/valuation');
const { estimateTrainingEta } = require('../services/training');
const { modeledEta, weeklyDrop } = require('../services/schum');
const { getSubskill } = require('../services/subskills');
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

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

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

  // Hattrick trains one club-wide skill at a time. This prefers a known
  // value — synced from CHPP's file=training, or manually reported through
  // CSV import (see services/sync.js and services/importCsv.js; both write
  // the same training_focus_* settings) — and otherwise falls back to
  // inferring it as whichever skill gained the most over the tracked window.
  const reportedSkillKey = getSetting('training_focus_skill');
  let trainedSkillKey = null;
  let trainingFocus = null;
  if (reportedSkillKey && SKILL_KEYS.includes(reportedSkillKey)) {
    trainedSkillKey = reportedSkillKey;
    trainingFocus = {
      skillKey: reportedSkillKey,
      label: SKILL_LABELS[reportedSkillKey],
      typeLabel: getSetting('training_focus_type_label'),
      source: getSetting('training_focus_source'),
      intensityPct: numOrNull(getSetting('training_focus_intensity_pct')),
      staminaPct: numOrNull(getSetting('training_focus_stamina_pct')),
      setAt: getSetting('training_focus_set_at'),
      coachName: getSetting('coach_name'),
      coachSkillLevel: numOrNull(getSetting('coach_skill_level')),
      coachSkillName: getSetting('coach_skill_name'),
      assistantLevels: numOrNull(getSetting('assistant_levels')),
    };
  } else {
    const gain = (key) => (snapshots.at(-1)?.[key] ?? 0) - (snapshots[0]?.[key] ?? 0);
    trainedSkillKey = snapshots.length >= 2
      ? SKILL_KEYS.reduce((best, key) => (gain(key) > gain(best) ? key : best), SKILL_KEYS[0])
      : null;
  }

  const trainingTypeId = numOrNull(getSetting('training_focus_type_id'));
  const assistantLevels = numOrNull(getSetting('assistant_levels'));

  const skills = SKILL_KEYS.map((key) => {
    const isTrainedForEta = trainedSkillKey && key !== 'skill_stamina' ? key === trainedSkillKey : null;
    const skill = {
      key,
      label: SKILL_LABELS[key],
      level: player[key],
      levelName: skillLevelName(player[key]),
      eta: estimateTrainingEta(snapshots, key, {
        // Stamina is maintained via the stamina share regardless of the
        // training focus, so it's never gated as "not trained."
        isTrained: isTrainedForEta,
        // Bound the rate window to the focus period only when the focus is
        // actually known (not inferred) — an inferred focus has no change date.
        sinceDate: trainingFocus && key === trainedSkillKey ? trainingFocus.setAt : null,
        ageYears: player.age_years,
      }),
    };

    // Second, independent estimate for the trained skill: Schum's community
    // formula + the sub-skill bookkeeping. Shown ALONGSIDE the observed one
    // — a mismatch between the two is itself a useful signal (training
    // slower than the formula expects → check intensity/coach/minutes).
    if (trainingFocus && key === trainedSkillKey) {
      const sub = getSubskill(playerId, key);
      const subProgress = sub && sub.anchored_level === player[key] ? Math.max(0, sub.sub_value) : 0;
      const modeled = modeledEta({
        skillLevel: player[key],
        subProgress,
        trainingTypeId,
        ageYears: player.age_years,
        intensityPct: trainingFocus.intensityPct,
        staminaPct: trainingFocus.staminaPct,
        coachLevel: trainingFocus.coachSkillLevel,
        assistantLevels,
        skillKey: key,
      });
      if (modeled) {
        skill.modeled = { ...modeled, progressPct: Math.round(subProgress * 100) };
      }
    } else if (isTrainedForEta === false && player[key] != null && player.age_years != null) {
      // Aging untrained skills: surface the modeled natural decay rate.
      const drop = weeklyDrop({ skillLevel: player[key], ageYears: player.age_years, skillKey: key, isTrained: false });
      if (drop > 0) skill.modeledWeeklyDrop = Math.round(drop * 1000) / 1000;
    }

    return skill;
  });

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
    trainingFocus,
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
