const express = require('express');
const { getSchedule, setSchedule } = require('../services/scheduler');

const router = express.Router();

router.get('/schedule', (req, res) => {
  res.json({ schedule: getSchedule() });
});

router.post('/schedule', express.json(), (req, res) => {
  const { schedule } = req.body || {};
  if (!Array.isArray(schedule)) {
    return res.status(400).json({ error: 'schedule must be an array of { day, time, label }.' });
  }
  const clean = [];
  for (const slot of schedule) {
    const day = Number(slot.day);
    const time = String(slot.time || '');
    if (!Number.isInteger(day) || day < 0 || day > 6 || !/^\d{2}:\d{2}$/.test(time)) {
      return res.status(400).json({ error: `Invalid slot: ${JSON.stringify(slot)}. day must be 0-6 (Sun-Sat), time must be HH:MM.` });
    }
    clean.push({ day, time, label: String(slot.label || '').slice(0, 60) });
  }
  setSchedule(clean);
  res.json({ ok: true, schedule: clean });
});

module.exports = router;
