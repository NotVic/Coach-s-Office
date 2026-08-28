// Schum's training formula + the community skill-drop model — the
// "modeled" estimate shown alongside the observed one.
//
// This is the community-reverse-engineered approximation of Hattrick's
// training engine (named for the forum user who fitted it to official
// skill-up data), NOT Hattrick's real published math — no such thing
// exists. Constants below are transcribed from the publicly documented
// formula as implemented in Hattrick Organizer's LGPL source
// (core/training/WeeklyTrainingType.java + subclasses, SkillDrops.java);
// the code here is an independent JS implementation, not a port.
//
//   weekly gain (fraction of a level) =
//     min(1, typeKoeff × K(time) × K(age) × K(assistants) × K(coach)
//              × K(stamina) × K(intensity) × f(skillLevel) × 0.01)

// f(L): higher skills train slower.
function skillLevelFactor(level) {
  return level < 9
    ? 16.289 * Math.exp(-0.1396 * level)
    : 54.676 / level - 1.438;
}

// Trainer skill → factor. Hattrick coaches effectively live in 4..8
// (Passable..Excellent); values outside are clamped to the table edge.
const COACH_FACTORS = { 4: 0.7343, 5: 0.8324, 6: 0.92, 7: 1.0, 8: 1.0375 };
function coachFactor(level) {
  const clamped = Math.min(8, Math.max(4, Math.round(level)));
  return COACH_FACTORS[clamped];
}

// Per-training-type base coefficient, keyed by the CHPP TrainingType id
// (same 2–12 enum as TRAINING_TYPES in chpp/parse.js). From HO's
// core/training/type/*.java.
const TYPE_COEFFICIENTS = {
  2: 14.7,  // Set Pieces
  3: 2.88,  // Defending
  4: 3.24,  // Scoring
  5: 4.8,   // Crossing (Winger)
  6: 1.5,   // Shooting
  7: 3.6,   // Short Passes
  8: 3.36,  // Playmaking
  9: 5.1,   // Goalkeeping
  10: 3.15, // Through Passes
  11: 1.38, // Defensive Positions
  12: 3.12, // Wing Attacks
};

function ageFactor(ageYears) {
  return 54 / (ageYears + 37);
}

/**
 * Fraction of a skill level gained in one full training week.
 * Unknown inputs get conservative defaults, each reported in
 * `assumptions` so the UI can say exactly what was guessed.
 * Returns null when the training type has no coefficient (e.g. a
 * CSV-reported "stamina" focus — stamina isn't a trainable type here).
 */
function weeklyGain({ skillLevel, trainingTypeId, ageYears, intensityPct, staminaPct, coachLevel, assistantLevels, timeFactor }) {
  const koeff = TYPE_COEFFICIENTS[trainingTypeId];
  if (koeff == null || skillLevel == null || ageYears == null) return null;

  const assumptions = [];
  if (intensityPct == null) { intensityPct = 100; assumptions.push('intensity assumed 100%'); }
  if (staminaPct == null) { staminaPct = 10; assumptions.push('stamina share assumed 10%'); }
  if (coachLevel == null) { coachLevel = 7; assumptions.push('coach assumed Solid (7)'); }
  if (assistantLevels == null) { assistantLevels = 0; assumptions.push('no assistant coaches assumed'); }
  if (timeFactor == null) {
    timeFactor = 1;
    assumptions.push('assumes full minutes in a trained position every match');
  }

  const gain = Math.min(1,
    koeff
    * timeFactor
    * ageFactor(ageYears)
    * (1 + 0.035 * Math.min(10, Math.max(0, assistantLevels)))
    * coachFactor(coachLevel)
    * (1 - staminaPct / 100)
    * (intensityPct / 100)
    * skillLevelFactor(skillLevel)
    * 0.01
  );

  return { gainPerWeek: gain, assumptions };
}

// ---- Skill drops (community model, from HO's SkillDrops.java) ----------

// Age at which each skill starts to decay naturally.
const DROP_START_AGE = {
  skill_keeper: 29, skill_defending: 28, skill_playmaking: 27, skill_winger: 27,
  skill_passing: 27, skill_scoring: 26, skill_setpieces: 30,
};

// Weekly age-drop by years past the skill's start age (index 1 = one year past).
const AGE_DROP_BY_YEARS_OVER = [0, 0.0003, 0.0014, 0.0037, 0.0074, 0.0127, 0.0197, 0.0285, 0.0393, 0.0522, 0.0673, 0.0846];

// High-level drag: skills ≥14 fight a level-dependent weekly drop.
function levelDrop(level) {
  if (level < 14) return 0;
  const L = level > 20 ? level + 0.39 : level;
  return 0.000006111 * L ** 3 + 0.000808 * L ** 2 - 0.026017 * L + 0.192775;
}

// Extra level×age drag from 31 on.
const LEVEL_AGE_COEFF = {
  31: { m: 0.00031, n: -0.00434 }, 32: { m: 0.00118, n: -0.01625 },
  33: { m: 0.00264, n: -0.03551 }, 34: { m: 0.00468, n: -0.06086 },
  35: { m: 0.00732, n: -0.09104 }, 36: { m: 0.01066, n: -0.12554 },
};
const LEVEL_AGE_COEFF_37PLUS = { m: 0.01460, n: -0.16021 };

function levelAgeDrop(level, ageYears) {
  if (ageYears < 31) return 0;
  const { m, n } = LEVEL_AGE_COEFF[ageYears] ?? LEVEL_AGE_COEFF_37PLUS;
  const L = level > 20 ? level + 1 : level;
  return Math.max(0, m * L + n);
}

/**
 * Modeled weekly decay (fraction of a level, ≥0) for one skill.
 * Per the community model, the level-dependent drag applies to the
 * currently trained skill; every skill past its age threshold decays
 * with age regardless of training.
 */
function weeklyDrop({ skillLevel, ageYears, skillKey, isTrained }) {
  if (skillLevel == null || ageYears == null) return 0;
  let drop = 0;
  const startAge = DROP_START_AGE[skillKey];
  if (startAge != null && ageYears > startAge) {
    const over = Math.min(ageYears - startAge, AGE_DROP_BY_YEARS_OVER.length - 1);
    drop += AGE_DROP_BY_YEARS_OVER[over];
  }
  if (isTrained) drop += levelDrop(skillLevel) + levelAgeDrop(skillLevel, ageYears);
  return drop;
}

/**
 * Modeled ETA for the trained skill: net weekly progress (gain − drops),
 * remaining fraction to the next level, and a ±20% presentation band —
 * the formula itself is a point estimate, but HO's own issue tracker
 * documents it landing about a week off for some players, so this app
 * never shows it as a bare number.
 */
function modeledEta({ skillLevel, subProgress = 0, trainingTypeId, ageYears, intensityPct, staminaPct, coachLevel, assistantLevels, skillKey }) {
  const gain = weeklyGain({ skillLevel, trainingTypeId, ageYears, intensityPct, staminaPct, coachLevel, assistantLevels });
  if (!gain) return null;
  const drop = weeklyDrop({ skillLevel, ageYears, skillKey, isTrained: true });
  const net = gain.gainPerWeek - drop;
  if (net <= 0) {
    return { status: 'decay_exceeds_gain', gainPerWeek: gain.gainPerWeek, dropPerWeek: drop, assumptions: gain.assumptions };
  }
  const remainingFraction = Math.max(0.01, 1 - subProgress);
  const weeks = remainingFraction / net;
  const low = Math.max(1, Math.round(weeks * 0.8));
  const high = Math.max(low + 1, Math.round(weeks * 1.2));
  return {
    status: 'ok',
    gainPerWeek: Math.round(net * 1000) / 1000,
    weeksPerLevel: Math.round((1 / net) * 10) / 10,
    low,
    high,
    assumptions: gain.assumptions,
  };
}

module.exports = {
  TYPE_COEFFICIENTS,
  skillLevelFactor,
  coachFactor,
  ageFactor,
  weeklyGain,
  weeklyDrop,
  modeledEta,
};
