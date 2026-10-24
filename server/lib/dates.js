// Snapshot dates are calendar days in the manager's own time zone (set TZ,
// e.g. TZ=Europe/Brussels in Docker). toISOString() would give the UTC day
// instead: an upload just after midnight in Belgium would land on the
// previous day, overwriting that day's snapshot and skewing week counts.

/** YYYY-MM-DD for `date` in the process's local time zone. */
function localDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

module.exports = { localDate };
