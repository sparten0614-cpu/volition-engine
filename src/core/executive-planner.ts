/**
 * Executive Planner
 * Selects the top desire to pursue, applies risk gate, manages mode switching.
 * Maps to PFC (planning) + ACC (cost-benefit) + LC-NE (explore-exploit).
 */

import { Desire, DesireEngineConfig, EngineState, EngineMode, RiskLevel, DriveSignal } from '../types.js';
import { rankDesires } from './salience-calculator.js';
import { SAFETY_INVARIANTS } from './safety.js';

export interface PlanDecision {
  action: 'pursue' | 'reflect' | 'explore' | 'wait' | 'blocked';
  desire?: Desire;
  score?: number;
  reason: string;
  mode: EngineMode;
  requiresApproval: boolean;
}

/**
 * Decide what to do next based on active desires and engine state.
 * Implements explore-exploit switching (LC-NE adaptive gain).
 */
export function planNextAction(
  desires: Desire[],
  signals: DriveSignal[],
  config: DesireEngineConfig,
  state: EngineState
): PlanDecision {
  // Filter to active desires only
  const activeDesires = desires.filter(d => d.status === 'active');

  // Check if we should enter reflective mode (DMN analog)
  if (shouldReflect(state, config, signals)) {
    return {
      action: 'reflect',
      reason: 'Entering reflective mode — reviewing strategy and consolidating memory',
      mode: EngineMode.REFLECTIVE,
      requiresApproval: false,
    };
  }

  // Action threshold with invariant floor (#9)
  const effectiveThreshold = Math.max(
    config.drives.action_threshold,
    SAFETY_INVARIANTS.ACTION_THRESHOLD_FLOOR
  );

  // Rank desires
  const ranked = rankDesires(activeDesires, config, state);

  if (ranked.length === 0) {
    // No desires — check if we should explore or wait
    const explorationSignal = signals.find(s => s.source === 'idle_anxiety' || s.source === 'curiosity_gap');

    if (explorationSignal && explorationSignal.intensity > effectiveThreshold) {
      return {
        action: 'explore',
        reason: `No active desires, but ${explorationSignal.source} signal at ${(explorationSignal.intensity * 100).toFixed(0)}% — scanning for new opportunities`,
        mode: EngineMode.EXPLORING,
        requiresApproval: false,
      };
    }

    return {
      action: 'wait',
      reason: 'No active desires and signals below threshold — standing by',
      mode: EngineMode.WAITING,
      requiresApproval: false,
    };
  }

  // Diversity bonus: desires not selected for 3+ consecutive cycles get a
  // temporary score boost. Prevents bottom-ranked desires from permanent
  // starvation — models the brain's novelty-seeking after habituation.
  const DIVERSITY_NEGLECT_THRESHOLD = 3;
  const DIVERSITY_BONUS = 0.05;
  for (const r of ranked) {
    const cyclesSinceSelected = r.desire.last_pursued
      ? Math.floor((Date.now() - new Date(r.desire.last_pursued).getTime()) / (state.total_cycles > 0 ? (Date.now() - new Date(state.last_cycle_at).getTime()) || 60000 : 60000))
      : DIVERSITY_NEGLECT_THRESHOLD; // Never pursued = eligible
    if (cyclesSinceSelected >= DIVERSITY_NEGLECT_THRESHOLD) {
      r.score = Math.min(1, r.score + DIVERSITY_BONUS);
    }
  }
  // Re-sort after bonus
  ranked.sort((a, b) => b.score - a.score);

  // Stochastic selection with re-roll: pick based on softmax probability from ranking.
  // With temperature=0.3, distribution is flatter — bottom desires get a chance.
  // If the selected desire is blocked by risk gate, re-roll up to MAX_REROLLS times.
  // This prevents high-risk desires from consuming cycles without producing action.
  const MAX_REROLLS = 3;
  let candidates = [...ranked];
  let top: { desire: Desire; score: number; probability: number } | null = null;

  for (let attempt = 0; attempt <= MAX_REROLLS; attempt++) {
    if (candidates.length === 0) break;

    const selected = pickFromCandidates(candidates);

    // Check if score exceeds action threshold
    if (selected.score < effectiveThreshold) {
      // Explore-exploit decision: low motivation for known goals → explore
      if (shouldExplore(state, config, signals)) {
        return {
          action: 'explore',
          reason: `Top desire "${selected.desire.goal}" below threshold (${(selected.score * 100).toFixed(0)}% < ${(effectiveThreshold * 100).toFixed(0)}%) — exploring instead`,
          mode: EngineMode.EXPLORING,
          requiresApproval: false,
        };
      }

      return {
        action: 'wait',
        reason: `Top desire "${selected.desire.goal}" below threshold (${(selected.score * 100).toFixed(0)}% < ${(effectiveThreshold * 100).toFixed(0)}%)`,
        mode: EngineMode.WAITING,
        requiresApproval: false,
      };
    }

    // Risk gate check
    const requiresApproval = checkRiskGate(selected.desire, config);

    if (requiresApproval) {
      // Remove blocked desire and re-roll
      candidates = candidates.filter(c => c.desire.id !== selected.desire.id);
      top = selected; // Keep as fallback if all candidates are blocked
      continue;
    }

    // Found a pursuable desire
    return {
      action: 'pursue',
      desire: selected.desire,
      score: selected.score,
      reason: `Pursuing "${selected.desire.goal}" (score: ${(selected.score * 100).toFixed(0)}%, source: ${selected.desire.source})`,
      mode: EngineMode.ACTIVE,
      requiresApproval: false,
    };
  }

  // All candidates blocked or exhausted re-rolls — report blocked on last selected
  if (top) {
    return {
      action: 'blocked',
      desire: top.desire,
      score: top.score,
      reason: `Desire "${top.desire.goal}" requires human approval (risk: ${top.desire.risk_level})`,
      mode: EngineMode.ACTIVE,
      requiresApproval: true,
    };
  }

  return {
    action: 'wait',
    reason: 'No actionable desires remaining after re-roll',
    mode: EngineMode.WAITING,
    requiresApproval: false,
  };
}

/**
 * Pick a desire from candidates using softmax stochastic selection.
 * Recomputes probabilities over the given candidate set.
 */
function pickFromCandidates(
  candidates: Array<{ desire: Desire; score: number; probability: number }>
): { desire: Desire; score: number; probability: number } {
  if (candidates.length === 1) return candidates[0];

  const maxScore = Math.max(...candidates.map(r => r.score));
  const temperature = 0.3;
  const exps = candidates.map(r => Math.exp((r.score - maxScore) / temperature));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  for (let i = 0; i < candidates.length; i++) {
    candidates[i].probability = exps[i] / sumExps;
  }

  const roll = Math.random();
  let cumProb = 0;
  for (const r of candidates) {
    cumProb += r.probability;
    if (roll < cumProb) {
      return r;
    }
  }
  return candidates[candidates.length - 1];
}

/**
 * Should we enter reflective mode? (DMN analog)
 * Triggered by: sufficient idle time + no urgent signals + time since last reflection
 */
function shouldReflect(
  state: EngineState,
  config: DesireEngineConfig,
  signals: DriveSignal[]
): boolean {
  // Don't reflect if there's urgent work
  const hasUrgentSignal = signals.some(s => s.intensity > 0.7);
  if (hasUrgentSignal) return false;

  // Don't reflect if already in reflective mode
  if (state.mode === EngineMode.REFLECTIVE) return false;

  // Check if it's been long enough since last reflection
  const reflectionSignal = signals.find(s => s.source === 'reflection_drive');
  return !!reflectionSignal;
}

/**
 * Should we explore? (LC-NE tonic mode)
 * Triggered by: low motivation for known goals + moderate idle time
 */
function shouldExplore(
  state: EngineState,
  config: DesireEngineConfig,
  signals: DriveSignal[]
): boolean {
  const curiositySignal = signals.find(s =>
    s.source === 'curiosity_gap' || s.source === 'idle_anxiety'
  );

  return !!curiositySignal && curiositySignal.intensity > config.drives.action_threshold * 0.8;
}

/**
 * Risk gate: does this desire require human approval?
 */
function checkRiskGate(desire: Desire, config: DesireEngineConfig): boolean {
  switch (desire.risk_level) {
    case RiskLevel.LOW:
      return !config.risk_gate.low_risk_autonomous;
    case RiskLevel.MEDIUM:
      return !config.risk_gate.medium_risk_notify; // Notify but don't block
    case RiskLevel.HIGH:
      return config.risk_gate.high_risk_approval;
    default:
      return true; // Unknown risk → require approval
  }
}
