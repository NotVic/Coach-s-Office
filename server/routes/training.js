const express = require('express');
const { buildTrainingBoard } = require('../services/trainingBoard');

const router = express.Router();

router.get('/', (req, res) => {
  // ?minutes=full asks the planning question ("what if I field everyone
  // where this training lands?"); the default is each player's own position.
  const assumeFullMinutes = req.query.minutes === 'full';
  res.json(buildTrainingBoard({ assumeFullMinutes }));
});

module.exports = router;
