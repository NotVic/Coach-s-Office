const express = require('express');
const { buildYouthAcademy, buildYouthPlayer } = require('../services/youthAcademy');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(buildYouthAcademy());
});

router.get('/:id', (req, res) => {
  const data = buildYouthPlayer(Number(req.params.id));
  if (!data) return res.status(404).json({ error: 'This player isn\'t in the youth academy (any more).' });
  res.json(data);
});

module.exports = router;
