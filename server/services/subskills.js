// Decimal sub-skill bookkeeping — the piece that turns Schum's weekly-gain
// formula (services/schum.js) into a running "~40% banked toward the next
// level" figure, the way Hattrick Organizer does it: CHPP only ever reports
// integer skill levels, so the fraction is reconstructed by accumulating
// the modeled weekly gain between syncs and recalibrating to zero every
// time CHPP confirms an actual integer level change.
//
// Rules:
// - Only the currently trained skill accumulates gains.
// - Any skill with an existing tracked row decays by the modeled age-drop
//   when it isn't the one being trained (past its age threshold).
// - A confirmed integer level change (up OR down) resets the fraction —
//   the observed integer is always the anchor, the model only fills in
//   between observations.
// - No known training focus → nothing accumulates (the model has no
//   inputs to run on); existing rows still decay.
const { db } = require('../db');
const schum = require('./schum');

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

const getRow = db.prepare('SELECT * FROM player_subskills WHERE player_id = ? AND skill_key = ?');
const upsertRow = db.prepare(`
  INSERT INTO player_subskills (player_id, skill_key, sub_value, anchored_level, updated_at)
  VALUES (@playerId, @skillKey, @subValue, @anchoredLevel, @updatedAt)
  ON CONFLICT(player_id, skill_key) DO UPDATE SET
    sub_value = excluded.sub_value, anchored_level = excluded.anchored_level, updated_at = excluded.updated_at
`);
const getAllForPlayer = db.prepare('SELECT * FROM player_subskills WHERE player_id = ?');

function clamp(v) {
  return Math.min(0.99, Math.max(-0.99, v));
}

/**
 * Update the bookkeeping after a sync/import has written fresh player rows.
 *
 * @param {Array} players rows shaped like services/store.js's upsertPlayer
 *   input (playerId, ageYears, keeper/defending/... skill fields)
 * @param {object|null} focus { skillKey, trainingTypeId, intensityPct, staminaPct }
 * @param {object} context { coachLevel, assistantLevels }
 * @param {string} nowIso
 */
function updateSubskills(players, focus, context = {}, nowIso = new Date().toISOString()) {
  const skillFieldOf = {
    skill_keeper: 'keeper', skill_defending: 'defending', skill_playmaking: 'playmaking',
    skill_winger: 'winger', skill_passing: 'passing', skill_scoring: 'scoring',
    skill_setpieces: 'setpieces', skill_stamina: 'stamina',
  };

  for (const p of players) {
    const tracked = getAllForPlayer.all(p.playerId);
    const trackedKeys = new Set(tracked.map((r) => r.skill_key));
    // Start tracking the trained skill the first time we see it in focus.
    const keysToProcess = new Set(trackedKeys);
    if (focus?.skillKey && skillFieldOf[focus.skillKey]) keysToProcess.add(focus.skillKey);

    for (const skillKey of keysToProcess) {
      const currentLevel = p[skillFieldOf[skillKey]];
      if (currentLevel == null) continue;
      const row = getRow.get(p.playerId, skillKey);
      const isTrained = focus?.skillKey === skillKey;

      if (!row) {
        upsertRow.run({ playerId: p.playerId, skillKey, subValue: 0, anchoredLevel: currentLevel, updatedAt: nowIso });
        continue;
      }
      // Confirmed integer change: the observation wins, fraction resets.
      if (row.anchored_level !== currentLevel) {
        upsertRow.run({ playerId: p.playerId, skillKey, subValue: 0, anchoredLevel: currentLevel, updatedAt: nowIso });
        continue;
      }

      const weeks = Math.max(0, (new Date(nowIso) - new Date(row.updated_at)) / MS_PER_WEEK);
      if (weeks === 0) continue;

      let delta = 0;
      if (isTrained) {
        const gain = schum.weeklyGain({
          skillLevel: currentLevel,
          trainingTypeId: focus.trainingTypeId,
          ageYears: p.ageYears,
          intensityPct: focus.intensityPct,
          staminaPct: focus.staminaPct,
          coachLevel: context.coachLevel,
          assistantLevels: context.assistantLevels,
        });
        if (gain) {
          delta = gain.gainPerWeek - schum.weeklyDrop({ skillLevel: currentLevel, ageYears: p.ageYears, skillKey, isTrained: true });
        }
      } else {
        delta = -schum.weeklyDrop({ skillLevel: currentLevel, ageYears: p.ageYears, skillKey, isTrained: false });
      }

      if (delta !== 0) {
        upsertRow.run({
          playerId: p.playerId, skillKey,
          subValue: clamp(row.sub_value + delta * weeks),
          anchoredLevel: currentLevel, updatedAt: nowIso,
        });
      } else {
        upsertRow.run({ playerId: p.playerId, skillKey, subValue: row.sub_value, anchoredLevel: currentLevel, updatedAt: nowIso });
      }
    }
  }
}

function getSubskill(playerId, skillKey) {
  return getRow.get(playerId, skillKey) ?? null;
}

module.exports = { updateSubskills, getSubskill };
