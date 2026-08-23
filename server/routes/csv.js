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

router.post('/import', express.json({ limit: '2mb' }), (req, res) => {
  const { csv, teamName } = req.body || {};
  if (!csv || !csv.trim()) {
    return res.status(400).json({ error: 'No CSV content received.' });
  }
  const result = importSquadCsv(csv, (teamName || '').trim());
  if (!result.ok) {
    return res.status(400).json({ error: 'The CSV has errors — nothing was imported.', rowErrors: result.errors });
  }
  res.json(result);
});

module.exports = router;
