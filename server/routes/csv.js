const express = require('express');
const { importSquadCsv } = require('../services/importCsv');
const { exportSquadCsv, templateCsv } = require('../services/exportCsv');
const { TRAINING_TYPES } = require('../chpp/parse');
const { db, getSetting } = require('../db');

const router = express.Router();

function settingNum(key) {
  const v = getSetting(key);
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// What the last import stored — the Settings form prefills from this so a
// weekly re-import doesn't mean re-typing training info that changes maybe
// once a season. Coach level is returned on the 1–5 scale Hattrick's own
// club page shows (stored internally on the global 4–8 scale the training
// model uses; the two map 1:1).
router.get('/defaults', (req, res) => {
  const coachGlobal = settingNum('coach_skill_level');
  const teamId = settingNum('chpp_team_id');
  const latestSnapshot = teamId
    ? db.prepare('SELECT cash, weekly_income, weekly_expenses FROM team_snapshots WHERE team_id = ? ORDER BY snapshot_date DESC LIMIT 1').get(teamId)
    : null;
  res.json({
    teamName: getSetting('data_source') === 'csv' ? getSetting('chpp_team_name') : null,
    trainingTypeId: settingNum('training_focus_type_id'),
    trainingIntensity: settingNum('training_focus_intensity_pct'),
    trainingStaminaPct: settingNum('training_focus_stamina_pct'),
    coachLevel5: coachGlobal != null && coachGlobal >= 4 && coachGlobal <= 8 ? coachGlobal - 3 : null,
    assistant1Level: settingNum('assistant1_level'),
    assistant2Level: settingNum('assistant2_level'),
    cash: latestSnapshot?.cash ?? null,
    weeklyIncome: latestSnapshot?.weekly_income ?? null,
    weeklyExpenses: latestSnapshot?.weekly_expenses ?? null,
  });
});

router.get('/template', (req, res) => {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="coachs-office-squad-template.csv"');
  res.send(templateCsv());
});

router.get('/export', (req, res) => {
  const csv = exportSquadCsv();
  if (csv == null) return res.status(400).json({ error: 'No squad to export yet — connect to Hattrick or import a CSV first.' });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="coachs-office-squad-export.csv"');
  res.send(csv);
});

function numberOrNull(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n; // undefined signals "present but invalid"
}

router.post('/import', express.json({ limit: '2mb' }), (req, res) => {
  const { csv, teamName, cash, weeklyIncome, weeklyExpenses, trainingTypeId, trainingIntensity, trainingStaminaPct, coachLevel5, assistant1Level, assistant2Level } = req.body || {};
  if (!csv || !csv.trim()) {
    return res.status(400).json({ error: 'No CSV content received.' });
  }

  const finances = { cash: numberOrNull(cash), weeklyIncome: numberOrNull(weeklyIncome), weeklyExpenses: numberOrNull(weeklyExpenses) };
  const badField = Object.entries(finances).find(([, v]) => v === undefined);
  if (badField) {
    return res.status(400).json({ error: `${badField[0]} must be a number, or left blank.` });
  }

  let trainingFocus = null;
  if (trainingTypeId !== undefined && trainingTypeId !== null && String(trainingTypeId).trim() !== '') {
    const typeId = numberOrNull(trainingTypeId);
    if (typeId === undefined || !TRAINING_TYPES[typeId]) {
      return res.status(400).json({ error: `trainingTypeId "${trainingTypeId}" isn't a recognized Hattrick training type.` });
    }
    const intensityPct = numberOrNull(trainingIntensity);
    const staminaPct = numberOrNull(trainingStaminaPct);
    // Coach and staff levels arrive on the 1–5 scale Hattrick's club page
    // shows; the import service converts the coach to the global 4–8 scale
    // the training model is keyed on (the two map 1:1).
    const coach5 = numberOrNull(coachLevel5);
    const assistant1 = numberOrNull(assistant1Level);
    const assistant2 = numberOrNull(assistant2Level);
    if (intensityPct === undefined) return res.status(400).json({ error: 'Training intensity must be a number, or left blank.' });
    if (staminaPct === undefined) return res.status(400).json({ error: 'Training stamina % must be a number, or left blank.' });
    if (coach5 === undefined || (coach5 != null && (coach5 < 1 || coach5 > 5))) {
      return res.status(400).json({ error: 'Coach skill must be 1–5 (as shown in Hattrick), or left blank.' });
    }
    for (const [label, v] of [['Assistant coach 1', assistant1], ['Assistant coach 2', assistant2]]) {
      if (v === undefined || (v != null && (v < 0 || v > 5))) {
        return res.status(400).json({ error: `${label} level must be 0–5, or left blank.` });
      }
    }
    trainingFocus = { trainingTypeId: typeId, intensityPct, staminaPct, coachLevel5: coach5, assistant1Level: assistant1, assistant2Level: assistant2 };
  }

  const result = importSquadCsv(csv, (teamName || '').trim(), finances, trainingFocus);
  if (!result.ok) {
    return res.status(400).json({ error: 'The CSV has errors — nothing was imported.', rowErrors: result.errors });
  }
  res.json(result);
});

module.exports = router;
