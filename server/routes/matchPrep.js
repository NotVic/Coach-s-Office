const express = require('express');
const { buildMatchPrep, saveManualFixture, clearManualFixture } = require('../services/matchPrep');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const data = await buildMatchPrep();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Manually-entered next fixture — the stand-in for CHPP's matches file
// while no CHPP connection exists. Everything asked for here is readable
// straight off hattrick.org (opponent's page shows their total TSI).
router.post('/manual', express.json(), (req, res) => {
  const { clear, opponentName, date, isHome, opponentTsi } = req.body || {};

  if (clear) {
    clearManualFixture();
    return res.json({ ok: true, cleared: true });
  }

  if (!opponentName || !String(opponentName).trim()) {
    return res.status(400).json({ error: 'Opponent name is required.' });
  }
  if (!date || Number.isNaN(new Date(date).getTime())) {
    return res.status(400).json({ error: 'A valid match date/time is required.' });
  }
  let tsi = null;
  if (opponentTsi !== undefined && opponentTsi !== null && String(opponentTsi).trim() !== '') {
    tsi = Number(opponentTsi);
    if (Number.isNaN(tsi) || tsi <= 0) {
      return res.status(400).json({ error: 'Opponent TSI must be a positive number, or left blank.' });
    }
  }

  saveManualFixture({
    opponentName: String(opponentName).trim().slice(0, 100),
    date: String(date),
    isHome: Boolean(isHome),
    opponentTsi: tsi,
  });
  res.json({ ok: true });
});

module.exports = router;
