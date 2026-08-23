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

router.post('/import', express.json({ limit: '2mb' }), (req, res) => {
  const { csv, teamName, cash, weeklyIncome, weeklyExpenses } = req.body || {};
  if (!csv || !csv.trim()) {
    return res.status(400).json({ error: 'No CSV content received.' });
  }

  const finances = { cash: numberOrNull(cash), weeklyIncome: numberOrNull(weeklyIncome), weeklyExpenses: numberOrNull(weeklyExpenses) };
  const badField = Object.entries(finances).find(([, v]) => v === undefined);
  if (badField) {
    return res.status(400).json({ error: `${badField[0]} must be a number, or left blank.` });
  }

  const result = importSquadCsv(csv, (teamName || '').trim(), finances);
  if (!result.ok) {
    return res.status(400).json({ error: 'The CSV has errors — nothing was imported.', rowErrors: result.errors });
  }
  res.json(result);
});

module.exports = router;
