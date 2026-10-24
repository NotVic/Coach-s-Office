// The Youth Academy view: what matters for a youth player is different from
// a senior one. There's no TSI or wage — the questions are "how high can
// the player go" (potential), "how much is still left to train" (headroom between
// current and potential), "how much do we actually know" (Hattrick reveals
// current/potential levels gradually) and "when can / must the player move up"
// (promotion from 17 after a minimum stay; tools like Hattrick Youthclub
// warn as a player nears 19).
//
// Ages run on Hattrick's calendar: one year = 112 days. The CSV's ages and
// "days until you can promote" are as of the import date, so they're
// rolled forward by the days elapsed since.
const { db } = require('../db');
const { skillLevelName, derivePositionLine } = require('../chpp/parse');
const { YOUTH_SKILLS } = require('./importYouthCsv');
const {
  YOUTH_TRAINING_TYPES, computeYouthCalibration, predictPlayer, trainedSlots, getYouthTrainingLog, historyByPlayer,
} = require('./youthTraining');

const DAYS_PER_YEAR = 112;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Thresholds on the best known potential, on Hattrick's 0-20 scale.
const HIGH_CEILING = 7; // solid or better
const LOW_CEILING = 5; // inadequate or worse
const AGE_OUT_YEARS = 19;
const SOON_DAYS = 28;

const SKILL_LABEL = Object.fromEntries(YOUTH_SKILLS.map(([k, label]) => [k, label]));

function daysSince(isoDate, now) {
  return Math.max(0, Math.floor((now - new Date(`${isoDate}T00:00:00Z`).getTime()) / MS_PER_DAY));
}

function trainingType(id) {
  const type = id != null ? YOUTH_TRAINING_TYPES[id] : null;
  return type ? { typeId: id, label: type.label, group: type.group, skillKeys: type.skills, individual: Boolean(type.individual) } : null;
}

/**
 * The academy's training as reported at the latest youth import, and since
 * when that same primary/secondary pair has been reported without a break.
 */
function readYouthTraining() {
  const log = db.prepare('SELECT * FROM youth_training_log ORDER BY log_date DESC').all();
  if (!log.length) return null;
  const latest = log[0];
  let since = latest.log_date;
  for (const row of log) {
    if (row.primary_type_id !== latest.primary_type_id || row.secondary_type_id !== latest.secondary_type_id) break;
    since = row.log_date;
  }
  const primary = trainingType(latest.primary_type_id);
  const secondary = trainingType(latest.secondary_type_id);
  return {
    primary,
    secondary,
    reportedOn: latest.log_date,
    since,
    // The raw log row, as the training model consumes it.
    row: latest,
    // Repeating the primary type as secondary halves the secondary slot.
    sameType: Boolean(primary && secondary && primary.typeId === secondary.typeId),
  };
}

/**
 * Academy-wide: which slot trains this skill. Individual training depends on
 * each player's position, so it isn't marked here (see skillsOf per player).
 */
function trainedAs(key, training) {
  for (const slot of ['primary', 'secondary']) {
    const t = training?.[slot];
    if (t && !t.individual && t.skillKeys.includes(key)) return slot;
  }
  return null;
}

function skillsOf(row, training) {
  return YOUTH_SKILLS.map(([key]) => {
    const cur = row[`cur_${key}`];
    const max = row[`max_${key}`];
    return {
      key,
      label: SKILL_LABEL[key],
      // Per player: individual training reaches only the skills that fit
      // the position played.
      trained: training ? trainedSlots(training.row, key, row.last_match_position)[0] ?? null : null,
      current: cur,
      potential: max,
      currentName: skillLevelName(cur),
      potentialName: skillLevelName(max),
      maxedOut: cur != null && max != null && cur >= max,
      headroom: cur != null && max != null ? Math.max(0, max - cur) : null,
    };
  });
}

function ceilingTier(level) {
  if (level == null) return 'unknown';
  if (level >= HIGH_CEILING) return 'high';
  if (level <= LOW_CEILING) return 'low';
  return 'medium';
}

/** One plain-language call per player, with the reason, so it can be checked rather than trusted. */
function verdictFor(p) {
  const { promotableNow, knownHeadroom, knownPairs, ceiling, daysUntilAgeOut } = p;
  const best = p.bestPotential;
  const bestText = best ? `${best.atLeast ? 'at least ' : ''}${best.name} (${best.level}) in ${best.label}` : null;
  // How much of the picture is known, so a call on thin evidence says so.
  const evidence = ` (${p.revealedPct}% of skill values revealed)`;
  if (promotableNow) {
    if (ceiling === 'low') {
      return { key: 'release', tone: 'critical', label: 'Release or promote', why: `Promotable, but the best known ceiling is ${bestText}${evidence}; the slot may be worth more for a new scout call.` };
    }
    if (knownPairs > 0 && knownHeadroom === 0) {
      return { key: 'promote', tone: 'good', label: 'Promote', why: `Promotable and every skill with a known potential is maxed out, so the academy can't add more there${evidence}.` };
    }
    if (daysUntilAgeOut != null && daysUntilAgeOut <= SOON_DAYS) {
      return { key: 'promote_soon', tone: 'warning', label: 'Promote soon', why: `Still +${knownHeadroom} known levels to gain, but turns 19 in ~${daysUntilAgeOut} days.` };
    }
    // Headroom only helps if the academy actually trains those skills.
    const trainedNote = p.trainedHeadroom == null ? ''
      : p.trainedHeadroom > 0 ? `, +${p.trainedHeadroom} of it in the skills you're training`
        : ', but none of it in the skills you\'re training now';
    // And whether the training model expects it to be reached in time.
    const m = p.maxOut;
    const modelNote = !m ? ''
      : m.beforeAgeOut === 'no'
        ? ` The training model expects ${m.skill} to need ~${m.low}–${m.high} more weeks, past age 19, so every week left still counts.`
        : ` The training model expects the trained skills to max out in ~${m.low}–${m.high} weeks${m.beforeAgeOut === 'tight' ? ' (tight before 19)' : ''}.`;
    return { key: 'train_on', tone: 'gold', label: 'Promotable, keep training', why: `Promotable now, but still +${knownHeadroom} known levels of headroom${knownPairs ? '' : ' (no potentials revealed yet)'}${trainedNote}.${modelNote}` };
  }
  if (ceiling === 'low') {
    return { key: 'release_candidate', tone: 'serious', label: 'Low ceiling', why: `Best known ceiling is ${bestText}${evidence}; consider releasing to make room for a better prospect.` };
  }
  if (ceiling === 'high') {
    return { key: 'develop', tone: 'good', label: 'Develop', why: `High ceiling: ${bestText}.` };
  }
  return { key: 'develop', tone: null, label: 'In development', why: ceiling === 'unknown' ? 'No skill levels revealed yet; field the player to learn more.' : `Mid ceiling (${bestText}); keep developing and watch for revelations.` };
}

function compareSnapshots(prev, cur) {
  const levelUps = [];
  const revealed = [];
  for (const [key, label] of YOUTH_SKILLS) {
    const [pc, cc] = [prev[`cur_${key}`], cur[`cur_${key}`]];
    const [pm, cm] = [prev[`max_${key}`], cur[`max_${key}`]];
    if (pc != null && cc != null && cc > pc) levelUps.push({ skill: label, from: pc, to: cc });
    if (pc == null && cc != null) revealed.push({ skill: label, what: 'current', level: cc });
    if (pm == null && cm != null) revealed.push({ skill: label, what: 'potential', level: cm });
  }
  return { levelUps, revealed };
}

/** Compares the reported training with where the known headroom is. Plain notes, most important first. */
function trainingAdvice(training, headroom) {
  if (!training || (!training.primary && !training.secondary)) {
    return ['Youth training wasn\'t reported at the last import, so the page can\'t tell whether it matches the headroom. Fill in primary and secondary training at the next upload.'];
  }
  const notes = [];
  const levelsOf = (skillKey) => headroom.find((h) => h.key === skillKey)?.levels ?? 0;
  const top = headroom[0];
  const individual = training.primary?.individual || training.secondary?.individual;
  if (training.sameType) {
    notes.push(`Primary and secondary are the same training (${training.primary.label}); a repeated secondary only counts half. Pick a different one for it.`);
  }
  for (const [slot, t] of [['Primary', training.primary], ['Secondary', training.secondary]]) {
    if (t && !t.individual && t.skillKeys.every((k) => levelsOf(k) === 0)) {
      notes.push(`${slot} training (${t.label}) has no known headroom left among players with a decent ceiling in ${t.skillKeys.map((k) => SKILL_LABEL[k]).join(' / ')}.`);
    }
  }
  if (individual) {
    notes.push('Individual training picks a skill per player that fits the position played, so field players where their headroom is.');
  }
  if (top && top.levels > 0 && !top.trainedAs && !individual) {
    notes.push(`The most known headroom is in ${top.label} (+${top.levels} levels over ${top.players.length} player${top.players.length === 1 ? '' : 's'}), which isn't being trained.`);
  }
  if (!notes.length) notes.push('Your youth training lines up with where the known headroom is.');
  return notes;
}

function buildYouthAcademy({ now = Date.now() } = {}) {
  const training = readYouthTraining();
  const rows = db.prepare('SELECT * FROM youth_players WHERE is_active = 1').all();
  if (rows.length === 0) return { hasYouth: false, training };
  const isTraining = Boolean(training?.primary || training?.secondary);
  const log = getYouthTrainingLog();
  const history = historyByPlayer();
  const calibration = computeYouthCalibration(log, history);

  const players = rows.map((row) => {
    const elapsed = daysSince(row.as_of_date, now);
    const ageTotal = (row.age_years ?? 0) * DAYS_PER_YEAR + (row.age_days ?? 0) + elapsed;
    const skills = skillsOf(row, training);
    // Ceiling per skill: the revealed potential, or else the current level
    // as a lower bound (a 6 today can reach at least 6).
    const floors = skills
      .map((s) => ({ s, level: s.potential ?? s.current, atLeast: s.potential == null }))
      .filter((f) => f.level != null);
    const bestFloor = floors.reduce((a, f) => (a == null || f.level > a.level || (f.level === a.level && !f.atLeast) ? f : a), null);
    const knownPairs = skills.filter((s) => s.headroom != null).length;
    const daysUntilPromotion = row.days_until_promotion == null ? null : Math.max(0, row.days_until_promotion - elapsed);
    const ageOutAt = AGE_OUT_YEARS * DAYS_PER_YEAR;

    const snapshots = history.get(row.youth_player_id) ?? [];
    const changes = snapshots.length >= 2 ? compareSnapshots(snapshots.at(-2), snapshots.at(-1)) : null;
    // Role by where the player can end up (potential, falling back to current).
    const roleBasis = Object.fromEntries(skills.map((s) => [s.key, s.potential ?? s.current ?? 0]));

    const p = {
      playerId: row.youth_player_id,
      name: row.name,
      nationality: row.nationality,
      specialty: row.specialty,
      age: { years: Math.floor(ageTotal / DAYS_PER_YEAR), days: ageTotal % DAYS_PER_YEAR },
      daysUntilPromotion,
      promotableNow: daysUntilPromotion === 0,
      daysUntilAgeOut: Math.max(0, ageOutAt - ageTotal),
      skills,
      bestPotential: bestFloor
        ? { key: bestFloor.s.key, label: bestFloor.s.label, level: bestFloor.level, name: skillLevelName(bestFloor.level), atLeast: bestFloor.atLeast }
        : null,
      ceiling: ceilingTier(bestFloor?.level),
      knownHeadroom: skills.reduce((sum, s) => sum + (s.headroom ?? 0), 0),
      // null when the academy's training wasn't reported at import.
      trainedHeadroom: isTraining ? skills.reduce((sum, s) => sum + (s.trained ? s.headroom ?? 0 : 0), 0) : null,
      knownPairs,
      // 14 values in all: current + potential for 7 skills.
      revealedPct: Math.round((skills.reduce((n, s) => n + (s.current != null) + (s.potential != null), 0) / (skills.length * 2)) * 100),
      suggestedRole: derivePositionLine(roleBasis).code,
      lastMatch: { date: row.last_match_date, rating: row.last_match_rating, position: row.last_match_position },
      ratingHistory: snapshots.filter((s) => s.last_match_rating != null).map((s) => ({ date: s.last_match_date || s.snapshot_date, rating: s.last_match_rating })),
      injuryWeeks: row.injury_weeks,
      sinceLastImport: changes,
      trackedSince: row.first_seen_date,
      snapshotCount: snapshots.length,
    };
    p.outlook = isTraining
      ? predictPlayer(
        { skills, ageYears: ageTotal / DAYS_PER_YEAR, position: row.last_match_position, daysUntilAgeOut: p.daysUntilAgeOut },
        snapshots, training.row, calibration.factor, training.since, now,
      )
      : [];
    // The slowest trained skill decides when the player is "done" here.
    p.maxOut = p.outlook
      .filter((o) => o.toPotential)
      .reduce((a, o) => (a == null || o.toPotential.high > a.high ? { skill: o.skill, ...o.toPotential } : a), null);
    p.verdict = verdictFor(p);
    return p;
  });

  players.sort((a, b) => (a.daysUntilPromotion ?? 999) - (b.daysUntilPromotion ?? 999) || (b.bestPotential?.level ?? 0) - (a.bestPotential?.level ?? 0));

  // Where youth training would still pay off: per skill, the known levels
  // left to gain, counted over the players with a decent ceiling in it.
  const trainingHeadroom = YOUTH_SKILLS.map(([key, label]) => {
    const relevant = players
      .map((p) => ({ p, s: p.skills.find((s) => s.key === key) }))
      .filter(({ s }) => s.headroom != null && s.headroom > 0 && s.potential > LOW_CEILING);
    return {
      key, label,
      trainedAs: trainedAs(key, training),
      levels: relevant.reduce((sum, { s }) => sum + s.headroom, 0),
      players: relevant.map(({ p, s }) => ({ name: p.name, from: s.current, to: s.potential })),
    };
  }).sort((a, b) => b.levels - a.levels);

  const asOf = rows.reduce((a, r) => (r.as_of_date > a ? r.as_of_date : a), '');
  return {
    hasYouth: true,
    asOfDate: asOf,
    training,
    trainingAdvice: trainingAdvice(training, trainingHeadroom),
    calibration,
    summary: {
      playerCount: players.length,
      promotableNow: players.filter((p) => p.promotableNow).length,
      promotableSoon: players.filter((p) => !p.promotableNow && p.daysUntilPromotion != null && p.daysUntilPromotion <= SOON_DAYS).length,
      highCeiling: players.filter((p) => p.ceiling === 'high').length,
      lowCeiling: players.filter((p) => p.ceiling === 'low').length,
      avgRevealedPct: Math.round(players.reduce((n, p) => n + p.revealedPct, 0) / players.length),
    },
    trainingHeadroom,
    players,
    thresholds: { highCeiling: HIGH_CEILING, lowCeiling: LOW_CEILING, soonDays: SOON_DAYS, ageOutYears: AGE_OUT_YEARS, daysPerYear: DAYS_PER_YEAR },
  };
}

module.exports = { buildYouthAcademy };
