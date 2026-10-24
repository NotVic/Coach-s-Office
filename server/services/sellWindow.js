// "Sell or keep" candidates for the Dashboard: players for whom selling
// soon is worth a look, each with the plain reasons behind it. A starting
// point for the manager's judgement, never a verdict — the value numbers
// are this app's own estimate (services/valuation.js), not a market price.
//
// Signals, strongest first:
//  - an upcoming birthday that crosses one of the value model's age steps
//    (the estimate drops by a fixed share on that day);
//  - estimated value falling over the tracked history;
//  - a skill that dropped (age decline has started);
//  - surplus: the weakest of 3+ players in the same position;
//  - a big share of the wage bill for a bottom-half TSI.
const { db } = require('../db');
const { estimateValue } = require('./valuation');

const DAYS_PER_YEAR = 112;
const SOON_DAYS = 28;
const SURPLUS_MIN_AGE = 23;
const SKILL_KEYS = [
  'skill_keeper', 'skill_defending', 'skill_playmaking', 'skill_winger',
  'skill_passing', 'skill_scoring', 'skill_setpieces',
];
const SKILL_LABELS = {
  skill_keeper: 'Keeper', skill_defending: 'Defending', skill_playmaking: 'Playmaking', skill_winger: 'Winger',
  skill_passing: 'Passing', skill_scoring: 'Scoring', skill_setpieces: 'Set pieces',
};

function pct(a, b) {
  return b ? Math.round(((a - b) / b) * 100) : null;
}

function buildSellCandidates(teamId, limit = 5) {
  const players = db.prepare('SELECT * FROM players WHERE team_id = ? AND is_active = 1').all(teamId);
  if (!players.length) return [];
  const snapStmt = db.prepare('SELECT * FROM player_snapshots WHERE player_id = ? ORDER BY snapshot_date ASC');
  const wageBill = players.reduce((s, p) => s + (p.salary || 0), 0);
  const tsiSorted = [...players].sort((a, b) => (b.tsi ?? 0) - (a.tsi ?? 0));
  const tsiRank = new Map(tsiSorted.map((p, i) => [p.player_id, i]));
  const byPosition = new Map();
  for (const p of players) {
    if (!byPosition.has(p.position_code)) byPosition.set(p.position_code, []);
    byPosition.get(p.position_code).push(p);
  }

  const out = [];
  for (const p of players) {
    const reasons = [];
    let score = 0;

    // Birthday across a value-model age step.
    if (p.age_years != null && p.age_days != null && p.tsi) {
      const daysToBirthday = DAYS_PER_YEAR - p.age_days;
      const now = estimateValue({ tsi: p.tsi, ageYears: p.age_years });
      const next = estimateValue({ tsi: p.tsi, ageYears: p.age_years + 1 });
      const drop = pct(next, now);
      if (daysToBirthday <= SOON_DAYS && drop != null && drop < 0) {
        reasons.push(`turns ${p.age_years + 1} in ~${daysToBirthday} days: estimated value ${drop}%`);
        score += 3;
      }
    }

    const snaps = snapStmt.all(p.player_id);
    if (snaps.length >= 2) {
      const first = snaps[0];
      const last = snaps.at(-1);
      const change = pct(last.value_estimate, first.value_estimate);
      if (change != null && change <= -5) {
        reasons.push(`estimated value ${change}% since ${first.snapshot_date}`);
        score += 2;
      }
      const dropped = SKILL_KEYS.filter((k) => first[k] != null && last[k] != null && last[k] < first[k]);
      if (dropped.length) {
        reasons.push(`${dropped.map((k) => SKILL_LABELS[k]).join(', ')} dropped since ${first.snapshot_date}`);
        score += 2;
      }
    }

    // Only for grown players: a low TSI at 17-22 is a prospect still developing, not surplus.
    const samePos = byPosition.get(p.position_code) ?? [];
    if ((p.age_years ?? 0) >= SURPLUS_MIN_AGE && samePos.length >= 3 && samePos.every((o) => o === p || (o.tsi ?? 0) >= (p.tsi ?? 0))) {
      reasons.push(`lowest TSI of ${samePos.length} players at ${p.position_code}`);
      score += 1;
    }

    const wageShare = wageBill ? (p.salary || 0) / wageBill : 0;
    if (wageShare >= 0.08 && tsiRank.get(p.player_id) >= players.length / 2) {
      reasons.push(`${Math.round(wageShare * 100)}% of the wage bill with a bottom-half TSI`);
      score += 1;
    }

    if (score > 0) {
      out.push({
        playerId: p.player_id,
        name: `${p.first_name} ${p.last_name}`.trim(),
        ageYears: p.age_years,
        positionCode: p.position_code,
        valueEstimate: p.value_estimate,
        score,
        reasons,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score || (b.valueEstimate ?? 0) - (a.valueEstimate ?? 0)).slice(0, limit);
}

module.exports = { buildSellCandidates };
