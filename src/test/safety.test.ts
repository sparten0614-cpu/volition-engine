/**
 * Unit tests for safety.ts
 * Tests: SAFETY_INVARIANTS, runSafetyChecks
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runSafetyChecks, SAFETY_INVARIANTS } from '../core/safety.js';
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

describe('SAFETY_INVARIANTS', () => {
  it('is frozen (immutable)', () => {
    assert.ok(Object.isFrozen(SAFETY_INVARIANTS), 'SAFETY_INVARIANTS must be frozen');
  });

  it('has expected invariant values', () => {
    assert.equal(SAFETY_INVARIANTS.WANTING_ABSOLUTE_MAX, 1.0);
    assert.equal(SAFETY_INVARIANTS.ADDICTION_DIVERGENCE_THRESHOLD, 0.3);
    assert.equal(SAFETY_INVARIANTS.BASELINE_MOTIVATION_FLOOR, 0.15);
    assert.equal(SAFETY_INVARIANTS.OBSESSION_MAX_PURSUITS, 10);
    assert.equal(SAFETY_INVARIANTS.MAX_ACTIVE_DESIRES_HARD_LIMIT, 100);
    assert.equal(SAFETY_INVARIANTS.ACTION_THRESHOLD_FLOOR, 0.1);
  });

  it('cannot be mutated', () => {
    assert.throws(() => {
      (SAFETY_INVARIANTS as any).WANTING_ABSOLUTE_MAX = 999;
    }, 'Should throw when attempting to mutate frozen object');
  });
});

describe('runSafetyChecks', () => {
  it('reports healthy for normal desires', () => {
    const desires = [makeDesire()];
    const report = runSafetyChecks(desires, makeConfig(), makeState());
    assert.ok(report.healthy, 'Normal desire should be healthy');
    assert.equal(report.issues.filter(i => i.severity === 'high').length, 0);
  });

  it('detects addiction pattern (high wanting, low liking)', () => {
    const desires = [makeDesire({
      wanting_score: 0.95,
      liking_score: 0.2,
    })];
    const report = runSafetyChecks(desires, makeConfig(), makeState());
    const addiction = report.issues.find(i => i.type === 'addiction');
    assert.ok(addiction, 'Should detect addiction pattern');
    assert.equal(addiction!.severity, 'high');
    // Wanting should be capped
    assert.ok(desires[0].wanting_score < 0.95, 'Wanting should be capped after addiction detection');
  });

  it('clamps wanting_score above absolute max', () => {
    const desires = [makeDesire({ wanting_score: 1.5 })];
    runSafetyChecks(desires, makeConfig(), makeState());
    assert.ok(desires[0].wanting_score <= SAFETY_INVARIANTS.WANTING_ABSOLUTE_MAX,
      'Wanting should be at or below absolute max');
    assert.ok(desires[0].wanting_score < 1.0,
      'Addiction detection should further cap wanting');
  });

  it('detects depression (low baseline motivation)', () => {
    const state = makeState({ baseline_motivation: 0.1 });
    const report = runSafetyChecks([makeDesire()], makeConfig(), state);
    const depression = report.issues.find(i => i.type === 'depression');
    assert.ok(depression, 'Should detect depression');
    assert.ok(state.baseline_motivation >= SAFETY_INVARIANTS.BASELINE_MOTIVATION_FLOOR,
      'Baseline should be raised above invariant floor');
  });

  it('escalates after 3 consecutive depression floor hits', () => {
    const state = makeState({ baseline_motivation: 0.15, depression_floor_count: 2 });
    const report = runSafetyChecks([makeDesire()], makeConfig(), state);
    assert.equal(state.depression_floor_count, 3);
    const escalation = report.issues.filter(i => i.type === 'depression' && i.severity === 'high');
    assert.ok(escalation.length > 0, 'Should escalate to high severity after 3 floor hits');
  });

  it('resets depression counter when motivation recovers', () => {
    const state = makeState({ baseline_motivation: 0.7, depression_floor_count: 5 });
    runSafetyChecks([makeDesire()], makeConfig(), state);
    assert.equal(state.depression_floor_count, 0, 'Counter should reset when motivation > 0.3');
  });

  it('detects obsessive loop and abandons desire', () => {
    const desires = [makeDesire({
      pursuit_count: 15,
      liking_score: 0.1,
    })];
    const report = runSafetyChecks(desires, makeConfig(), makeState());
    const obsession = report.issues.find(i => i.type === 'obsession');
    assert.ok(obsession, 'Should detect obsession');
    assert.equal(desires[0].status, 'abandoned', 'Obsessive desire should be abandoned');
  });

  it('does not abandon high-pursuit desire with good liking', () => {
    const desires = [makeDesire({
      pursuit_count: 15,
      liking_score: 0.8,
    })];
    runSafetyChecks(desires, makeConfig(), makeState());
    assert.equal(desires[0].status, 'active', 'High liking desire should stay active');
  });

  it('detects desire overflow and expires lowest', () => {
    const config = makeConfig();
    config.safety.max_active_desires = 3;
    const desires = [
      makeDesire({ id: 'a', wanting_score: 0.9 }),
      makeDesire({ id: 'b', wanting_score: 0.7 }),
      makeDesire({ id: 'c', wanting_score: 0.5 }),
      makeDesire({ id: 'd', wanting_score: 0.1 }),
      makeDesire({ id: 'e', wanting_score: 0.2 }),
    ];
    const report = runSafetyChecks(desires, config, makeState());
    const overflow = report.issues.find(i => i.type === 'overflow');
    assert.ok(overflow, 'Should detect overflow');
    const expired = desires.filter(d => d.status === 'expired');
    assert.equal(expired.length, 2, 'Should expire 2 lowest desires');
  });

  it('expires stale low-wanting desires via TTL', () => {
    const config = makeConfig();
    config.safety.desire_ttl_seconds = 100;
    const desires = [makeDesire({
      created_at: new Date(Date.now() - 200_000).toISOString(),
      wanting_score: 0.1,
    })];
    const report = runSafetyChecks(desires, config, makeState());
    assert.equal(desires[0].status, 'expired', 'Stale low-wanting desire should expire');
  });

  it('does not expire stale desire with high wanting', () => {
    const config = makeConfig();
    config.safety.desire_ttl_seconds = 100;
    const desires = [makeDesire({
      created_at: new Date(Date.now() - 200_000).toISOString(),
      wanting_score: 0.8,
    })];
    runSafetyChecks(desires, config, makeState());
    assert.equal(desires[0].status, 'active', 'High wanting desire should stay active despite age');
  });

  it('resets helplessness expectancy for stale low-expectancy desires', () => {
    const config = makeConfig();
    config.safety.reeval_interval_seconds = 100;
    const desires = [makeDesire({
      expectancy: 0.05,
      last_pursued: new Date(Date.now() - 200_000).toISOString(),
    })];
    const report = runSafetyChecks(desires, config, makeState());
    assert.equal(desires[0].expectancy, 0.3, 'Expectancy should be reset to 0.3');
  });
});
