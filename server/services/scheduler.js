// Hattrick's weekly processing time isn't the same for every manager — it
// shifts by league/country bloc (e.g. Belgium is training Fri ~01:00 /
// matches Sun ~13:00, so that league's sync times should be ~07:00 Fri and
// ~16:00 Sun). So instead of a hardcoded cron schedule, this polls once a
// minute and fires a sync when the current day/time crosses a
// user-configured slot, tracking an "already fired today" marker per slot
// so it only runs once.
const { getSetting, setSetting } = require('../db');
const { runFullSync } = require('./sync');

const CHECK_INTERVAL_MS = 60 * 1000;
let timer = null;

function getSchedule() {
  try {
    return JSON.parse(getSetting('sync_schedule', '[]')) || [];
  } catch {
    return [];
  }
}

function setSchedule(slots) {
  setSetting('sync_schedule', JSON.stringify(slots));
}

async function tick() {
  if (!getSetting('chpp_access_token')) return; // nothing to sync yet

  const schedule = getSchedule();
  if (!schedule.length) return;

  const now = new Date();
  const day = now.getDay(); // 0 = Sunday … 6 = Saturday
  const hm = now.toTimeString().slice(0, 5); // "HH:MM", 24h, zero-padded — safe to compare lexicographically
  const dateKey = now.toISOString().slice(0, 10);

  for (const slot of schedule) {
    if (slot.day !== day || hm < slot.time) continue;
    const firedKey = `sync_fired_${slot.day}_${slot.time}`;
    if (getSetting(firedKey) === dateKey) continue; // already ran this slot today
    setSetting(firedKey, dateKey);
    try {
      await runFullSync({ isInitial: false });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[scheduler] sync failed:', err.message);
    }
  }
}

function start() {
  if (timer) return;
  timer = setInterval(tick, CHECK_INTERVAL_MS);
  tick();
}

function stop() {
  clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, getSchedule, setSchedule };
