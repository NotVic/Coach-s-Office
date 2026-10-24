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

function skillsOf(row) {
  return YOUTH_SKILLS.map(([key]) => {
    const cur = row[`cur_${key}`];
    const max = row[`max_${key}`];
    return {
      key,
      label: SKILL_LABEL[key],
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
    return { key: 'train_on', tone: 'gold', label: 'Promotable, keep training', why: `Promotable now, but still +${knownHeadroom} known levels of headroom${knownPairs ? '' : ' (no potentials revealed yet)'}.` };
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

function buildYouthAcademy({ now = Date.now() } = {}) {
  const rows = db.prepare('SELECT * FROM youth_players WHERE is_active = 1').all();
  if (rows.length === 0) return { hasYouth: false };

  const snapStmt = db.prepare('SELECT * FROM youth_snapshots WHERE youth_player_id = ? ORDER BY snapshot_date ASC');

  const players = rows.map((row) => {
    const elapsed = daysSince(row.as_of_date, now);
    const ageTotal = (row.age_years ?? 0) * DAYS_PER_YEAR + (row.age_days ?? 0) + elapsed;
    const skills = skillsOf(row);
    // Ceiling per skill: the revealed potential, or else the current level
    // as a lower bound (a 6 today can reach at least 6).
    const floors = skills
      .map((s) => ({ s, level: s.potential ?? s.current, atLeast: s.potential == null }))
      .filter((f) => f.level != null);
    const bestFloor = floors.reduce((a, f) => (a == null || f.level > a.level || (f.level === a.level && !f.atLeast) ? f : a), null);
    const knownPairs = skills.filter((s) => s.headroom != null).length;
    const daysUntilPromotion = row.days_until_promotion == null ? null : Math.max(0, row.days_until_promotion - elapsed);
    const ageOutAt = AGE_OUT_YEARS * DAYS_PER_YEAR;

    const snapshots = snapStmt.all(row.youth_player_id);
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
      levels: relevant.reduce((sum, { s }) => sum + s.headroom, 0),
      players: relevant.map(({ p, s }) => ({ name: p.name, from: s.current, to: s.potential })),
    };
  }).sort((a, b) => b.levels - a.levels);

  const asOf = rows.reduce((a, r) => (r.as_of_date > a ? r.as_of_date : a), '');
  return {
    hasYouth: true,
    asOfDate: asOf,
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
