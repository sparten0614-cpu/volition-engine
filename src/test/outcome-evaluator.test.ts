/**
 * Unit tests for outcome-evaluator.ts
 * Tests: evaluateOutcome, RPE learning, dynamic learning rate
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOutcome } from '../core/outcome-evaluator.js';
import { Desire, DesireEngineConfig, EngineState, EngineMode, DriveType, RiskLevel, RewardSource } from '../types.js';

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
    novelty_bonus: 0.5,
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

function makeConfig(): DesireEngineConfig {
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

describe('evaluateOutcome', () => {
  it('computes positive RPE when actual > predicted', () => {
    const desire = makeDesire({ predicted_reward: 0.5 });
    const record = evaluateOutcome(desire, 0.8, RewardSource.COMPLETION, 'test', makeConfig(), makeState());
    assert.ok(record.rpe > 0, `RPE should be positive, got ${record.rpe}`);
    assert.equal(record.actual_reward, 0.8);
  });

  it('computes negative RPE when actual < predicted', () => {
    const desire = makeDesire({ predicted_reward: 0.7 });
    const record = evaluateOutcome(desire, 0.3, RewardSource.COMPLETION, 'test', makeConfig(), makeState());
    assert.ok(record.rpe < 0, `RPE should be negative, got ${record.rpe}`);
  });

  it('updates predicted_reward toward actual via EMA', () => {
    const desire = makeDesire({ predicted_reward: 0.5 });
    evaluateOutcome(desire, 0.9, RewardSource.COMPLETION, 'test', makeConfig(), makeState());
    assert.ok(desire.predicted_reward > 0.5, 'Predicted reward should increase after positive surprise');
    assert.ok(desire.predicted_reward < 0.9, 'Predicted reward should not jump to actual (EMA)');
  });

  it('increases wanting_score on positive RPE', () => {
    const desire = makeDesire({ wanting_score: 0.5, predicted_reward: 0.3 });
    evaluateOutcome(desire, 0.8, RewardSource.COMPLETION, 'test', makeConfig(), makeState());
    assert.ok(desire.wanting_score > 0.5, `Wanting should increase, got ${desire.wanting_score}`);
  });

  it('decreases wanting_score on negative RPE', () => {
    const desire = makeDesire({ wanting_score: 0.5, predicted_reward: 0.8 });
    evaluateOutcome(desire, 0.2, RewardSource.COMPLETION, 'test', makeConfig(), makeState());
    assert.ok(desire.wanting_score < 0.5, `Wanting should decrease, got ${desire.wanting_score}`);
  });

  it('caps wanting_score at max_wanting_score', () => {
    const config = makeConfig();
    const desire = makeDesire({ wanting_score: 0.94, predicted_reward: 0.1 });
    evaluateOutcome(desire, 1.0, RewardSource.COMPLETION, 'test', config, makeState());
    assert.ok(desire.wanting_score <= config.safety.max_wanting_score,
      `Wanting ${desire.wanting_score} should not exceed ${config.safety.max_wanting_score}`);
  });

  it('updates liking_score as rolling average', () => {
    const desire = makeDesire({ liking_score: 0.5, liking_history: [0.5] });
    evaluateOutcome(desire, 0.9, RewardSource.COMPLETION, 'test', makeConfig(), makeState());
    assert.ok(desire.liking_score > 0.5, 'Liking should increase with good outcome');
    assert.equal(desire.liking_history.length, 2);
  });

  it('keeps liking_history capped at 10 entries', () => {
    const desire = makeDesire({
      liking_history: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    });
    evaluateOutcome(desire, 0.9, RewardSource.COMPLETION, 'test', makeConfig(), makeState());
    assert.equal(desire.liking_history.length, 10, 'History should stay at max 10');
  });

  it('increments pursuit_count', () => {
    const desire = makeDesire({ pursuit_count: 3 });
    evaluateOutcome(desire, 0.5, RewardSource.COMPLETION, 'test', makeConfig(), makeState());
    assert.equal(desire.pursuit_count, 4);
  });

  it('sets last_pursued timestamp', () => {
    const desire = makeDesire();
    const before = Date.now();
    evaluateOutcome(desire, 0.5, RewardSource.COMPLETION, 'test', makeConfig(), makeState());
    assert.ok(desire.last_pursued, 'last_pursued should be set');
    const ts = new Date(desire.last_pursued!).getTime();
    assert.ok(ts >= before - 1000, 'Timestamp should be recent');
  });

  it('strengthens habit with low RPE (expected outcome)', () => {
    const desire = makeDesire({ habit_strength: 0.1, predicted_reward: 0.5 });
    evaluateOutcome(desire, 0.52, RewardSource.COMPLETION, 'test', makeConfig(), makeState());
    assert.ok(desire.habit_strength > 0.1, `Habit should strengthen, got ${desire.habit_strength}`);
  });

  it('weakens habit with large negative RPE', () => {
    const desire = makeDesire({ habit_strength: 0.5, predicted_reward: 0.8 });
    evaluateOutcome(desire, 0.2, RewardSource.COMPLETION, 'test', makeConfig(), makeState());
    assert.ok(desire.habit_strength < 0.5, `Habit should weaken, got ${desire.habit_strength}`);
  });

  it('increases expectancy on success', () => {
    const desire = makeDesire({ expectancy: 0.5 });
    evaluateOutcome(desire, 0.8, RewardSource.COMPLETION, 'test', makeConfig(), makeState());
    assert.ok(desire.expectancy > 0.5, `Expectancy should increase, got ${desire.expectancy}`);
  });

  it('decreases expectancy on failure (but floors at 0.05)', () => {
    const desire = makeDesire({ expectancy: 0.1 });
    evaluateOutcome(desire, 0.1, RewardSource.COMPLETION, 'test', makeConfig(), makeState());
    assert.ok(desire.expectancy >= 0.05, `Expectancy should not go below 0.05, got ${desire.expectancy}`);
  });

  it('abandons desire at expectancy floor after many pursuits', () => {
    const desire = makeDesire({ expectancy: 0.06, pursuit_count: 9 }); // Will be 10 after
    evaluateOutcome(desire, 0.1, RewardSource.COMPLETION, 'test', makeConfig(), makeState());
    assert.equal(desire.status, 'abandoned', 'Should abandon after 10+ pursuits at expectancy floor');
  });

  it('updates baseline_motivation based on RPE', () => {
    const state = makeState({ baseline_motivation: 0.5 });
    const desire = makeDesire({ predicted_reward: 0.3 });
    evaluateOutcome(desire, 0.9, RewardSource.COMPLETION, 'test', makeConfig(), state);
    assert.ok(state.baseline_motivation > 0.5, 'Baseline should increase on positive RPE');
  });

  it('clamps actual reward to [0, 1]', () => {
    const desire = makeDesire({ predicted_reward: 0.5 });
    const record = evaluateOutcome(desire, 2.0, RewardSource.COMPLETION, 'test', makeConfig(), makeState());
    assert.equal(record.actual_reward, 1.0, 'Reward should be clamped to 1.0');
  });

  it('spontaneous recovery boosts baseline near floor', () => {
    const state = makeState({ baseline_motivation: 0.25 });
    const desire = makeDesire({ predicted_reward: 0.5 });
    evaluateOutcome(desire, 0.5, RewardSource.COMPLETION, 'test', makeConfig(), state);
    assert.ok(state.baseline_motivation >= 0.25, 'Baseline should not drop further near floor');
  });

  it('decays novelty_bonus over time', () => {
    const desire = makeDesire({
      novelty_bonus: 0.8,
      created_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 48h old
    });
    evaluateOutcome(desire, 0.5, RewardSource.COMPLETION, 'test', makeConfig(), makeState());
    assert.ok(desire.novelty_bonus < 0.8, `Novelty should decay, got ${desire.novelty_bonus}`);
    assert.ok(desire.novelty_bonus >= 0.1, 'Novelty should not go below floor 0.1');
  });
});
