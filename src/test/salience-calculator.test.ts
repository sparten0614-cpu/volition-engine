/**
 * Unit tests for salience-calculator.ts
 * Tests: computeMotivationScore, rankDesires
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeMotivationScore, rankDesires } from '../core/salience-calculator.js';
import { Desire, DesireEngineConfig, EngineState, EngineMode, DriveType, RiskLevel } from '../types.js';

// ── Test fixtures ──

function makeDesire(overrides: Partial<Desire> = {}): Desire {
  return {
    id: 'test-1',
    goal: 'Test goal',
    drive_weights: {
      [DriveType.HOMEOSTATIC]: 0.2,
      [DriveType.COGNITIVE]: 0.5,
      [DriveType.SOCIAL]: 0.2,
      [DriveType.SELF_ACTUALIZATION]: 0.1,
    },
    wanting_score: 0.5,
    predicted_reward: 0.5,
    novelty_bonus: 0.3,
    liking_score: 0.5,
    liking_history: [0.5],
    expectancy: 0.6,
    cost: 0.2,
    urgency: 0.4,
    risk_level: RiskLevel.LOW,
    habit_strength: 0.0,
    source: 'internal',
    created_at: new Date().toISOString(),
    pursuit_count: 0,
    status: 'active',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<DesireEngineConfig> = {}): DesireEngineConfig {
  return {
    personality: 'balanced-partner',
    drives: {
      idle_anxiety_rate: 0.12,
      action_threshold: 0.30,
      curiosity_weight: 0.6,
      mastery_weight: 0.5,
      social_weight: 0.4,
      reflection_interval_seconds: 3600,
    },
    learning: {
      rpe_learning_rate: 0.1,
      reinforcement_rate: 0.05,
      habituation_rate: 0.02,
      min_learning_rate: 0.02,
      max_learning_rate: 0.3,
    },
    safety: {
      max_wanting_score: 0.95,
      min_activity_interval_seconds: 1800,
      reeval_interval_seconds: 86400,
      diversity_min_types: 2,
      max_active_desires: 30,
      desire_ttl_seconds: 604800,
    },
    risk_gate: {
      low_risk_autonomous: true,
      medium_risk_notify: true,
      high_risk_approval: true,
    },
    temporal: {
      discount_rate: 0.95,
      urgency_boost_near_deadline: 2.0,
    },
    ...overrides,
  };
}

function makeState(overrides: Partial<EngineState> = {}): EngineState {
  return {
    baseline_motivation: 0.7,
    idle_since: new Date().toISOString(),
    idle_duration_seconds: 0,
    mode: EngineMode.ACTIVE,
    recent_success_rate: 0.5,
    total_cycles: 10,
    last_cycle_at: new Date().toISOString(),
    depression_floor_count: 0,
    ...overrides,
  };
}

// ── Tests ──

describe('computeMotivationScore', () => {
  it('returns a score in [0, 1]', () => {
    const score = computeMotivationScore(makeDesire(), makeConfig(), makeState());
    assert.ok(score >= 0, `Score ${score} should be >= 0`);
    assert.ok(score <= 1, `Score ${score} should be <= 1`);
  });

  it('higher wanting produces higher score', () => {
    const config = makeConfig();
    const state = makeState();
    const low = computeMotivationScore(makeDesire({ wanting_score: 0.2 }), config, state);
    const high = computeMotivationScore(makeDesire({ wanting_score: 0.9 }), config, state);
    assert.ok(high > low, `wanting=0.9 score (${high}) should exceed wanting=0.2 score (${low})`);
  });

  it('higher cost reduces score', () => {
    const config = makeConfig();
    const state = makeState();
    const cheap = computeMotivationScore(makeDesire({ cost: 0.1 }), config, state);
    const expensive = computeMotivationScore(makeDesire({ cost: 0.9 }), config, state);
    assert.ok(cheap > expensive, `Low cost score (${cheap}) should exceed high cost score (${expensive})`);
  });

  it('baseline motivation affects score', () => {
    const config = makeConfig();
    const desire = makeDesire();
    const highBaseline = computeMotivationScore(desire, config, makeState({ baseline_motivation: 1.0 }));
    const lowBaseline = computeMotivationScore(desire, config, makeState({ baseline_motivation: 0.2 }));
    assert.ok(highBaseline > lowBaseline, `High baseline (${highBaseline}) should exceed low baseline (${lowBaseline})`);
  });

  it('returns 0 for all-zero desire with high cost', () => {
    const score = computeMotivationScore(
      makeDesire({
        wanting_score: 0,
        liking_score: 0,
        novelty_bonus: 0,
        urgency: 0,
        expectancy: 0,
        cost: 1.0,
      }),
      makeConfig(),
      makeState()
    );
    assert.equal(score, 0, 'All-zero desire with max cost should score 0');
  });

  it('completion boost increases score after multiple successful pursuits', () => {
    const config = makeConfig();
    const state = makeState();
    const fresh = computeMotivationScore(
      makeDesire({ pursuit_count: 0, liking_score: 0.7 }),
      config, state
    );
    const veteran = computeMotivationScore(
      makeDesire({ pursuit_count: 5, liking_score: 0.7 }),
      config, state
    );
    assert.ok(veteran > fresh, `Veteran pursuit (${veteran}) should exceed fresh (${fresh}) due to completion boost`);
  });

  it('completion boost does not apply with low liking', () => {
    const config = makeConfig();
    const state = makeState();
    const lowLiking = computeMotivationScore(
      makeDesire({ pursuit_count: 5, liking_score: 0.3 }),
      config, state
    );
    const noHistory = computeMotivationScore(
      makeDesire({ pursuit_count: 0, liking_score: 0.3 }),
      config, state
    );
    assert.equal(lowLiking, noHistory, 'Completion boost should not apply with liking <= 0.5');
  });

  it('novelty bonus floors at 0.1 to prevent zero-out', () => {
    const config = makeConfig();
    const state = makeState();
    const zeroNovelty = computeMotivationScore(
      makeDesire({ novelty_bonus: 0 }),
      config, state
    );
    // Score should still be > 0 because novelty is floored at 0.1
    assert.ok(zeroNovelty > 0, `Zero novelty should still produce non-zero score (${zeroNovelty})`);
  });

  it('deadline in the past gives urgency boost', () => {
    const config = makeConfig();
    const state = makeState();
    const pastDeadline = new Date(Date.now() - 86400000).toISOString();
    const withDeadline = computeMotivationScore(
      makeDesire({ deadline: pastDeadline }),
      config, state
    );
    const withoutDeadline = computeMotivationScore(
      makeDesire(),
      config, state
    );
    // Past deadline applies urgency_boost (2.0), so score should be higher
    assert.ok(withDeadline > withoutDeadline,
      `Past deadline score (${withDeadline}) should exceed no deadline (${withoutDeadline})`);
  });
});

describe('rankDesires', () => {
  it('returns empty array for no desires', () => {
    const result = rankDesires([], makeConfig(), makeState());
    assert.equal(result.length, 0);
  });

  it('returns desires sorted by score descending', () => {
    const desires = [
      makeDesire({ id: 'low', wanting_score: 0.1, urgency: 0.1 }),
      makeDesire({ id: 'high', wanting_score: 0.9, urgency: 0.9 }),
      makeDesire({ id: 'mid', wanting_score: 0.5, urgency: 0.5 }),
    ];
    const ranked = rankDesires(desires, makeConfig(), makeState());
    assert.equal(ranked[0].desire.id, 'high');
    assert.equal(ranked[ranked.length - 1].desire.id, 'low');
  });

  it('probabilities sum to approximately 1', () => {
    const desires = [
      makeDesire({ id: 'a', wanting_score: 0.3 }),
      makeDesire({ id: 'b', wanting_score: 0.6 }),
      makeDesire({ id: 'c', wanting_score: 0.9 }),
    ];
    const ranked = rankDesires(desires, makeConfig(), makeState());
    const totalProb = ranked.reduce((sum, r) => sum + r.probability, 0);
    assert.ok(
      Math.abs(totalProb - 1.0) < 0.001,
      `Probabilities should sum to ~1, got ${totalProb}`
    );
  });

  it('higher temperature gives more uniform probabilities', () => {
    const desires = [
      makeDesire({ id: 'a', wanting_score: 0.3, urgency: 0.2 }),
      makeDesire({ id: 'b', wanting_score: 0.9, urgency: 0.8 }),
    ];
    const config = makeConfig();
    const state = makeState();

    const sharpRanked = rankDesires(desires, config, state, 0.05);
    const flatRanked = rankDesires(desires, config, state, 1.0);

    const sharpTopProb = sharpRanked[0].probability;
    const flatTopProb = flatRanked[0].probability;

    assert.ok(sharpTopProb > flatTopProb,
      `Sharp temp top prob (${sharpTopProb}) should exceed flat temp (${flatTopProb})`);
  });

  it('single desire gets probability 1.0', () => {
    const ranked = rankDesires([makeDesire()], makeConfig(), makeState());
    assert.equal(ranked.length, 1);
    assert.ok(Math.abs(ranked[0].probability - 1.0) < 0.001);
  });
});
