// Hattrick does not publish a transfer-value formula, and CHPP does not
// expose a per-player market value for players who aren't currently listed
// (only `AskingPrice` for listed players). Every other Hattrick tool that
// shows a "value" for an unlisted player is estimating it from TSI, age and
// specialty — this is the same idea, kept deliberately simple and always
// surfaced as a range rather than a single confident number ("precision
// honesty" — see the "About the estimates" note in the Settings page).
//
// This is NOT a reverse-engineered version of Hattrick's internal formula —
// it is a transparent, order-of-magnitude estimator. Treat its output as a
// starting point for a manager's own judgement, never as a quote.

const BASE_PER_TSI = 55; // currency units per TSI point, before age/specialty adjustment

function ageMultiplier(ageYears) {
  if (ageYears == null) return 1;
  if (ageYears <= 21) return 1.25;
  if (ageYears <= 24) return 1.4; // peak resale window
  if (ageYears <= 27) return 1.15;
  if (ageYears <= 30) return 0.85;
  if (ageYears <= 33) return 0.55;
  return 0.3;
}

function specialtyMultiplier(specialtyId) {
  // Specialties are a real tactical premium but a small one; keep it flat
  // rather than pretending to know per-specialty market premiums.
  return specialtyId ? 1.05 : 1;
}

/** Returns a point estimate; callers should present it as a ~range, never a bare number. */
function estimateValue({ tsi, ageYears, specialtyId }) {
  if (tsi == null || tsi <= 0) return null;
  const raw = tsi * BASE_PER_TSI * ageMultiplier(ageYears) * specialtyMultiplier(specialtyId);
  return Math.round(raw / 1000) * 1000; // round to the nearest 1,000
}

/** A ±15% band around the point estimate — this is a rough model, say so visually. */
function estimateValueRange(input) {
  const mid = estimateValue(input);
  if (mid == null) return null;
  return {
    low: Math.round((mid * 0.85) / 1000) * 1000,
    mid,
    high: Math.round((mid * 1.15) / 1000) * 1000,
  };
}

module.exports = { estimateValue, estimateValueRange };
