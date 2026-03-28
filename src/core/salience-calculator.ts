/**
 * Salience Calculator
 * Computes motivation scores for desires using weighted sum (not multiplication).
 * Fixes: multiplication zero-out problem, score compression problem.
 */

import { Desire, DesireEngineConfig, EngineState } from '../types.js';

/**
 * Compute the motivation score for a single desire.
 * Uses weighted sum instead of multiplication to avoid zero-out.
 * Applies softmax-style selection across all desires.
 */
export function computeMotivationScore(
  desire: Desire,
  config: DesireEngineConfig,
  state: EngineState
): number {
  // Temporal discount based on deadline
  const temporalDiscount = desire.deadline
    ? computeTemporalDiscount(desire.deadline, config.temporal.discount_rate, config.temporal.urgency_boost_near_deadline)
    : 1.0;

  // Completion drive: wanting accelerates as pursuit count grows with good results.
  // Models the "90% done" effect — humans feel compelled to finish what they started.
  // Kicks in after 2+ pursuits with above-average liking.
  const completionBoost = (desire.pursuit_count >= 2 && desire.liking_score > 0.5)
    ? Math.min(0.15, desire.pursuit_count * 0.02 * desire.liking_score)
    : 0;

  // Weighted sum for value (not multiplication — avoids zero-out)
  // Weights rationale:
  //   wanting (0.30) > liking (0.15): system biases toward pursuit over comfort,
  //     per Berridge — wanting drives behavior more than liking.
  //   urgency (0.20) + expectancy (0.20) = 40%: practical factors balance desire signals.
  //   novelty (0.15): exploration bonus, floored at 0.1 to prevent zero-out.
  // These weights define agent "personality" — tune per deployment.
  const value =
    desire.wanting_score * 0.30 +
    desire.liking_score * 0.15 +
    Math.max(desire.novelty_bonus, 0.1) * 0.15 +
    desire.urgency * 0.20 +
    desire.expectancy * 0.20 +
    completionBoost;

  // Apply baseline motivation (tonic dopamine analog)
  // #15: Wider baseline influence range: (0.3 + 0.7*b) → [0.44, 1.0] = 56% modulation
  const baselineBoost = state.baseline_motivation;
  const baselineMultiplier = 0.3 + 0.7 * baselineBoost;

  // Raw motivation = value * temporal_discount * baseline - cost
  // #14: Cost penalty raised from 0.5 to 0.75 — high-cost desires are harder to pursue
  const raw = (value * temporalDiscount * baselineMultiplier) - (desire.cost * 0.75);

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, raw));
}

/**
 * Rank desires using softmax-inspired temperature scaling.
 * This amplifies differences between similar scores (fixes score compression).
 */
export function rankDesires(
  desires: Desire[],
  config: DesireEngineConfig,
  state: EngineState,
  temperature: number = 0.3
): Array<{ desire: Desire; score: number; probability: number }> {
  if (desires.length === 0) return [];

  // Compute raw scores
  const scored = desires.map(d => ({
    desire: d,
    score: computeMotivationScore(d, config, state),
  }));

  // Softmax with temperature to amplify differences
  const maxScore = Math.max(...scored.map(s => s.score));
  const exps = scored.map(s => Math.exp((s.score - maxScore) / temperature));
  const sumExps = exps.reduce((a, b) => a + b, 0);

  const ranked = scored.map((s, i) => ({
    ...s,
    probability: exps[i] / sumExps,
  }));

  // Sort by score descending
  ranked.sort((a, b) => b.score - a.score);

  return ranked;
}

/**
 * Temporal discount: future rewards decay with distance.
 * Uses hyperbolic discounting (more biologically accurate than exponential).
 */
function computeTemporalDiscount(
  deadline: string,
  discountRate: number,
  urgencyBoost: number
): number {
  const now = Date.now();
  const deadlineMs = new Date(deadline).getTime();
  const daysUntilDeadline = (deadlineMs - now) / (1000 * 60 * 60 * 24);

  if (daysUntilDeadline <= 0) {
    // Past deadline — max urgency
    return urgencyBoost;
  }

  if (daysUntilDeadline <= 1) {
    // Within 24h — urgency boost
    return 1.0 + (urgencyBoost - 1.0) * (1 - daysUntilDeadline);
  }

  // Hyperbolic discount: V = 1 / (1 + k * t)
  const k = 1 - discountRate; // Convert discount_rate to k
  return 1 / (1 + k * daysUntilDeadline);
}
