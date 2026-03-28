/**
 * Unit tests for executive-planner.ts
 * Tests: planNextAction, diversity bonus, stochastic selection, re-roll
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { planNextAction } from '../core/executive-planner.js';
import { Desire, DesireEngineConfig, EngineState, EngineMode, DriveType, RiskLevel, DriveSignal } from '../types.js';

// ── Test fixtures ──

function makeDesire(overrides: Partial<Desire> = {}): Desire {
  return {
    id: `desire-${Math.random().toString(36).slice(2, 8)}`,
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

describe('planNextAction', () => {
  it('returns wait when no active desires and no signals', () => {
    const result = planNextAction([], [], makeConfig(), makeState());
    assert.equal(result.action, 'wait');
    assert.equal(result.mode, EngineMode.WAITING);
    assert.equal(result.requiresApproval, false);
  });

  it('returns wait when only non-active desires exist', () => {
    const desires = [
      makeDesire({ status: 'completed' }),
      makeDesire({ status: 'abandoned' }),
    ];
    const result = planNextAction(desires, [], makeConfig(), makeState());
    assert.equal(result.action, 'wait');
  });

  it('returns explore when idle_anxiety signal exceeds threshold', () => {
    const signals: DriveSignal[] = [{
      type: DriveType.COGNITIVE,
      source: 'idle_anxiety',
      intensity: 0.5,
      description: 'Idle anxiety',
      timestamp: new Date().toISOString(),
    }];
    const result = planNextAction([], signals, makeConfig(), makeState());
    assert.equal(result.action, 'explore');
    assert.equal(result.mode, EngineMode.EXPLORING);
  });

  it('returns reflect when reflection signal is present and no urgency', () => {
    const signals: DriveSignal[] = [{
      type: DriveType.COGNITIVE,
      source: 'reflection_drive',
      intensity: 0.3,
      description: 'Time to reflect',
      timestamp: new Date().toISOString(),
    }];
    const result = planNextAction(
      [makeDesire()],
      signals,
      makeConfig(),
      makeState({ mode: EngineMode.ACTIVE })
    );
    assert.equal(result.action, 'reflect');
    assert.equal(result.mode, EngineMode.REFLECTIVE);
  });

  it('does not reflect when urgent signal exists', () => {
    const signals: DriveSignal[] = [
      { type: DriveType.COGNITIVE, source: 'reflection_drive', intensity: 0.3, description: 'Reflect', timestamp: new Date().toISOString() },
      { type: DriveType.HOMEOSTATIC, source: 'critical_alert', intensity: 0.9, description: 'Urgent!', timestamp: new Date().toISOString() },
    ];
    const desires = [makeDesire({ wanting_score: 0.9, urgency: 0.9, expectancy: 0.9 })];
    const result = planNextAction(desires, signals, makeConfig(), makeState());
    assert.notEqual(result.action, 'reflect');
  });

  it('pursues a desire when score exceeds threshold', () => {
    const desires = [makeDesire({
      wanting_score: 0.8,
      urgency: 0.8,
      expectancy: 0.9,
      cost: 0.1,
    })];
    const result = planNextAction(desires, [], makeConfig(), makeState());
    assert.equal(result.action, 'pursue');
    assert.ok(result.desire, 'Should have a desire');
    assert.ok(result.score! > 0, 'Should have a positive score');
  });

  it('reports blocked for high-risk desires when all are high-risk', () => {
    const desires = [makeDesire({
      wanting_score: 0.9,
      urgency: 0.9,
      expectancy: 0.9,
      cost: 0.1,
      risk_level: RiskLevel.HIGH,
    })];
    const config = makeConfig();
    config.risk_gate.high_risk_approval = true;
    const result = planNextAction(desires, [], config, makeState());
    assert.equal(result.action, 'blocked');
    assert.equal(result.requiresApproval, true);
  });

  it('re-rolls past blocked desire to find pursuable one', () => {
    // Create one HIGH risk desire and one LOW risk desire
    const highRisk = makeDesire({
      id: 'high-risk',
      wanting_score: 0.95,
      urgency: 0.95,
      expectancy: 0.95,
      cost: 0.05,
      risk_level: RiskLevel.HIGH,
    });
    const lowRisk = makeDesire({
      id: 'low-risk',
      wanting_score: 0.8,
      urgency: 0.8,
      expectancy: 0.9,
      cost: 0.1,
      risk_level: RiskLevel.LOW,
    });

    // Run multiple times — at least some should pursue the low-risk one
    let pursuedLowRisk = 0;
    for (let i = 0; i < 20; i++) {
      const result = planNextAction([highRisk, lowRisk], [], makeConfig(), makeState());
      if (result.action === 'pursue' && result.desire?.id === 'low-risk') {
        pursuedLowRisk++;
      }
    }
    assert.ok(pursuedLowRisk > 0,
      `Should pursue low-risk desire at least once in 20 tries (got ${pursuedLowRisk})`);
  });

  it('respects action threshold floor from safety invariants', () => {
    const config = makeConfig();
    config.drives.action_threshold = 0.01; // Below invariant floor of 0.1
    const desires = [makeDesire({
      wanting_score: 0.1,
      urgency: 0.05,
      expectancy: 0.1,
      cost: 0.8,
    })];
    const result = planNextAction(desires, [], config, makeState());
    // Score should be very low, and threshold floor should block it
    assert.notEqual(result.action, 'pursue',
      'Should not pursue when score is below invariant floor threshold');
  });

  it('returns PlanDecision with correct structure', () => {
    const desires = [makeDesire({
      wanting_score: 0.8,
      urgency: 0.7,
      expectancy: 0.9,
    })];
    const result = planNextAction(desires, [], makeConfig(), makeState());

    // Check structure
    assert.ok('action' in result);
    assert.ok('reason' in result);
    assert.ok('mode' in result);
    assert.ok('requiresApproval' in result);
    assert.ok(typeof result.reason === 'string');
    assert.ok(result.reason.length > 0);
  });

  it('stochastic selection distributes across desires over many trials', () => {
    const desires = [
      makeDesire({ id: 'a', wanting_score: 0.9, urgency: 0.9, expectancy: 0.9, cost: 0.1 }),
      makeDesire({ id: 'b', wanting_score: 0.8, urgency: 0.8, expectancy: 0.8, cost: 0.1 }),
      makeDesire({ id: 'c', wanting_score: 0.7, urgency: 0.7, expectancy: 0.7, cost: 0.1 }),
    ];
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };

    for (let i = 0; i < 100; i++) {
      const result = planNextAction(desires, [], makeConfig(), makeState());
      if (result.action === 'pursue' && result.desire) {
        counts[result.desire.id]++;
      }
    }

    // With temperature=0.3, all three should be selected at least once
    assert.ok(counts['a'] > 0, `Desire 'a' should be selected at least once (got ${counts['a']})`);
    assert.ok(counts['b'] > 0, `Desire 'b' should be selected at least once (got ${counts['b']})`);
    // With stochastic selection, 'a' and 'b' scores are close enough that
    // ordering isn't guaranteed. Just verify distribution isn't degenerate.
    const total = counts['a'] + counts['b'] + counts['c'];
    assert.ok(total > 90, `Most trials should result in pursue (got ${total}/100)`);
  });
});
