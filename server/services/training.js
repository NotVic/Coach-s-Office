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
//
// The one piece of community math used is Schum's age factor
// f(age) = 54 / (age + 37) — weekly training speed is proportional to it —
// applied only as a *correction* on the observed rate (a player's observed
// window ages behind them), never as a from-scratch prediction.

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

function weeksBetween(isoA, isoB) {
  return (new Date(isoB).getTime() - new Date(isoA).getTime()) / MS_PER_WEEK;
}

/** Schum's age factor: weekly training speed ∝ 54/(age+37). */
function ageFactor(ageYears) {
  return 54 / (ageYears + 37);
}

function lastGainDate(points, skillKey) {
  for (let i = points.length - 1; i > 0; i--) {
    if (points[i][skillKey] > points[i - 1][skillKey]) return points[i].snapshot_date;
  }
  return null;
}

/**
 * @param {Array<{snapshot_date: string, [skillKey]: number}>} snapshots ascending by date
 * @param {string} skillKey e.g. 'skill_playmaking'
 * @param {object} [opts]
 * @param {boolean|null} [opts.isTrained] true = this is the club's current
 *   training focus; false = it isn't (ETA countdown suppressed — a countdown
 *   on an untrained skill reads as if it's still progressing, which is the
 *   single most misleading number the old version could show); null/undefined
 *   = focus unknown, keep estimating from history alone. Callers must never
 *   pass false for skill_stamina — stamina is maintained by the stamina-share
 *   every week regardless of the training focus.
 * @param {string|null} [opts.sinceDate] only use snapshots from this date on
 *   (the training-focus change date) so a mid-window focus switch can't blend
 *   two different training regimes into one misleading average rate.
 * @param {number|null} [opts.ageYears] player age now, for the age correction.
 */
function estimateTrainingEta(snapshots, skillKey, opts = {}) {
  const { isTrained = null, sinceDate = null, ageYears = null } = opts;
  const allPoints = snapshots.filter((s) => s[skillKey] != null);

  // Not the current training focus: no countdown, but a real drop is still
  // worth surfacing — decline is age/level-driven and hits untrained skills
  // hardest, so check it before settling on the quiet "not trained" state.
  if (isTrained === false) {
    if (allPoints.length >= 2) {
      const first = allPoints[0];
      const last = allPoints[allPoints.length - 1];
      if (last[skillKey] < first[skillKey]) {
        return {
          status: 'declining',
          from: first[skillKey],
          to: last[skillKey],
          sinceDate: first.snapshot_date,
        };
      }
    }
    return { status: 'not_trained', lastGainDate: lastGainDate(allPoints, skillKey) };
  }

  // For the trained skill, a known focus-change date bounds the window: the
  // rate before the switch belongs to a different training regime.
  const points = sinceDate
    ? allPoints.filter((s) => s.snapshot_date >= sinceDate)
    : allPoints;

  if (points.length < 2) {
    if (sinceDate && allPoints.length >= 2) {
      return {
        status: 'building_history',
        message: 'Training focus changed recently — history since then is still accumulating, check back after your next sync.',
        sinceDate,
      };
    }
    return { status: 'no_history', message: 'Not enough tracked history yet — check back after your next sync.' };
  }

  const first = points[0];
  const last = points[points.length - 1];
  const totalWeeks = weeksBetween(first.snapshot_date, last.snapshot_date);
  const totalGain = last[skillKey] - first[skillKey];

  if (totalWeeks <= 0) {
    return { status: 'no_history', message: 'Not enough tracked history yet — check back after your next sync.' };
  }
  if (totalGain < 0) {
    return { status: 'declining', from: first[skillKey], to: last[skillKey], sinceDate: first.snapshot_date };
  }
  if (totalGain === 0) {
    return { status: 'stalled', message: 'No level-up seen yet in the tracked history for this skill.' };
  }

  let weeksPerLevel = totalWeeks / totalGain;

  // Age correction: the observed rate reflects the player's age *during* the
  // window, but the projection runs at their age *now*. Rate ∝ f(age), so
  // weeksPerLevel scales by f(ageMid)/f(ageNow). Snapshots don't store age,
  // so approximate the window-midpoint age from the current age minus half
  // the window length — at this app's window lengths (weeks to a few months)
  // the approximation error is far smaller than the estimate's own spread.
  let ageAdjusted = false;
  if (ageYears != null && ageYears > 0) {
    const ageMid = ageYears - (totalWeeks / 2) / 52;
    weeksPerLevel *= ageFactor(ageMid) / ageFactor(ageYears);
    ageAdjusted = true;
  }

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
  // Older players train slower AND less predictably (decline effects start
  // stacking in the late 20s) — widen the uncertainty band, don't just
  // stretch the midpoint.
  const spreadMultiplier = ageYears != null && ageYears >= 28 ? 1.5 : 1;
  const spread = Math.max(weeksPerLevel * 0.3, 0.5) * spreadMultiplier;
  const low = Math.max(1, Math.round(remaining - spread));
  const high = Math.max(low + 1, Math.round(remaining + spread));

  return {
    status: 'training',
    currentLevel: last[skillKey],
    weeksPerLevel: Math.round(weeksPerLevel * 10) / 10,
    ageAdjusted,
    low,
    high,
  };
}

module.exports = { estimateTrainingEta, ageFactor };
