const express = require('express');
const { buildMatchPrep } = require('../services/matchPrep');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const data = await buildMatchPrep();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
