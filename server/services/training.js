// Training-ETA estimator.
//
// Hattrick's training-speed formula is not officially published (only
// reverse-engineered, imperfectly, by the community) and CHPP does not
// expose a player's fractional progress toward their next skill level. So
// rather than pretend to reproduce Hattrick's internal math, this estimates
// purely from what this app has actually observed: how often *this*
// player's *this* skill has leveled up in the snapshot history we've
// collected since connecting. No history yet → no estimate; that's an
// honest empty state, not a bug.

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

function weeksBetween(isoA, isoB) {
  return (new Date(isoB).getTime() - new Date(isoA).getTime()) / MS_PER_WEEK;
}

/**
 * @param {Array<{snapshot_date: string, [skillKey]: number}>} snapshots ascending by date
 * @param {string} skillKey e.g. 'skill_playmaking'
 */
function estimateTrainingEta(snapshots, skillKey) {
  const points = snapshots.filter((s) => s[skillKey] != null);
  if (points.length < 2) {
    return { status: 'no_history', message: 'Not enough tracked history yet — check back after your next sync.' };
  }

  const first = points[0];
  const last = points[points.length - 1];
  const totalWeeks = weeksBetween(first.snapshot_date, last.snapshot_date);
  const totalGain = last[skillKey] - first[skillKey];

  if (totalWeeks <= 0) {
    return { status: 'no_history', message: 'Not enough tracked history yet — check back after your next sync.' };
  }
  if (totalGain <= 0) {
    return { status: 'stalled', message: 'No level-up seen yet in the tracked history for this skill.' };
  }

  const weeksPerLevel = totalWeeks / totalGain;

  // Weeks since the most recent observed level-up, so the estimate counts
  // down rather than restarting from the full per-level average every time.
  let weeksSinceLevelUp = totalWeeks;
  for (let i = points.length - 1; i > 0; i--) {
    if (points[i][skillKey] > points[i - 1][skillKey]) {
      weeksSinceLevelUp = weeksBetween(points[i].snapshot_date, last.snapshot_date);
      break;
    }
  }

  const remaining = Math.max(weeksPerLevel - weeksSinceLevelUp, 0.5);
  const spread = Math.max(weeksPerLevel * 0.3, 0.5);
  const low = Math.max(1, Math.round(remaining - spread));
  const high = Math.max(low + 1, Math.round(remaining + spread));

  return {
    status: 'training',
    currentLevel: last[skillKey],
    weeksPerLevel: Math.round(weeksPerLevel * 10) / 10,
    low,
    high,
  };
}

module.exports = { estimateTrainingEta };
