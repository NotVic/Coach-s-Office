const express = require('express');
const { getSetting } = require('../db');
const { computeRecentChanges } = require('../services/changes');

const router = express.Router();

router.get('/', (req, res) => {
  const teamId = Number(getSetting('chpp_team_id'));
  if (!teamId) return res.json({ ready: false, reason: 'not_connected' });

  const changes = computeRecentChanges(teamId);
  if (!changes.ready) return res.json(changes);

  res.json({ ...changes, valueMovers: changes.valueMovers.slice(0, 10) });
});

module.exports = router;
