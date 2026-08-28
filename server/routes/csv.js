const express = require('express');
const { importSquadCsv } = require('../services/importCsv');
const { exportSquadCsv, templateCsv } = require('../services/exportCsv');

const router = express.Router();

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

const TRAINING_SKILL_KEYS = [
  'skill_keeper', 'skill_defending', 'skill_playmaking', 'skill_winger',
  'skill_passing', 'skill_scoring', 'skill_setpieces', 'skill_stamina',
];

router.post('/import', express.json({ limit: '2mb' }), (req, res) => {
  const { csv, teamName, cash, weeklyIncome, weeklyExpenses, trainingSkill, trainingIntensity, trainingStaminaPct, coachLevel, assistantLevels } = req.body || {};
  if (!csv || !csv.trim()) {
    return res.status(400).json({ error: 'No CSV content received.' });
  }

  const finances = { cash: numberOrNull(cash), weeklyIncome: numberOrNull(weeklyIncome), weeklyExpenses: numberOrNull(weeklyExpenses) };
  const badField = Object.entries(finances).find(([, v]) => v === undefined);
  if (badField) {
    return res.status(400).json({ error: `${badField[0]} must be a number, or left blank.` });
  }

  let trainingFocus = null;
  if (trainingSkill) {
    if (!TRAINING_SKILL_KEYS.includes(trainingSkill)) {
      return res.status(400).json({ error: `trainingSkill "${trainingSkill}" isn't a recognized skill.` });
    }
    const intensityPct = numberOrNull(trainingIntensity);
    const staminaPct = numberOrNull(trainingStaminaPct);
    const coach = numberOrNull(coachLevel);
    const assistants = numberOrNull(assistantLevels);
    if (intensityPct === undefined) return res.status(400).json({ error: 'Training intensity must be a number, or left blank.' });
    if (staminaPct === undefined) return res.status(400).json({ error: 'Training stamina % must be a number, or left blank.' });
    if (coach === undefined || (coach != null && (coach < 4 || coach > 8))) {
      return res.status(400).json({ error: 'Coach skill level must be 4–8, or left blank.' });
    }
    if (assistants === undefined || (assistants != null && (assistants < 0 || assistants > 10))) {
      return res.status(400).json({ error: 'Assistant coach levels must be 0–10, or left blank.' });
    }
    trainingFocus = { skillKey: trainingSkill, intensityPct, staminaPct, coachLevel: coach, assistantLevels: assistants };
  }

  const result = importSquadCsv(csv, (teamName || '').trim(), finances, trainingFocus);
  if (!result.ok) {
    return res.status(400).json({ error: 'The CSV has errors — nothing was imported.', rowErrors: result.errors });
  }
  res.json(result);
});

module.exports = router;
