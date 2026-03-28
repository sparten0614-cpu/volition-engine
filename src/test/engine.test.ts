/**
 * Integration tests for engine.ts (DesireEngine)
 * Tests: full cycle, event emission, desire CRUD, config safety
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DesireEngine, EngineEvent, ActionResult } from '../engine.js';
import { DesireEngineConfig, DriveType, RiskLevel, RewardSource, EngineMode } from '../types.js';
import type { DriveContext } from '../core/drive-generator.js';

// ── Test helpers ──

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `volition-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir: string) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

const TEST_CONFIG: DesireEngineConfig = {
  personality: 'test-agent',
  drives: {
    idle_anxiety_rate: 0.12,
    action_threshold: 0.20,
    curiosity_weight: 0.6,
    mastery_weight: 0.5,
    social_weight: 0.4,
    reflection_interval_seconds: 9999,
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

function mockContextProvider(): () => Promise<DriveContext> {
  return async () => ({
    resourceStatus: { diskUsagePercent: 50, memoryUsagePercent: 40 },
  });
}

function mockActionExecutor(reward = 0.7): (desire: any, decision: any) => Promise<ActionResult> {
  return async () => ({
    success: true,
    reward,
    reward_source: RewardSource.COMPLETION,
    action_description: 'Test action completed',
  });
}

// ── Tests ──

describe('DesireEngine', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) cleanup(d);
    dirs.length = 0;
  });

  it('creates engine and runs a cycle with no desires', async () => {
    const dir = tmpDir(); dirs.push(dir);
    const engine = new DesireEngine({
      dataDir: dir,
      config: TEST_CONFIG,
      contextProvider: mockContextProvider(),
      actionExecutor: mockActionExecutor(),
    });

    const decision = await engine.runCycle();
    assert.equal(decision.action, 'wait');
    engine.stop();
  });

  it('creates a desire and retrieves it via ranking', () => {
    const dir = tmpDir(); dirs.push(dir);
    const engine = new DesireEngine({
      dataDir: dir,
      config: TEST_CONFIG,
      contextProvider: mockContextProvider(),
      actionExecutor: mockActionExecutor(),
    });

    const desire = engine.createDesire({
      goal: 'Test goal',
      drive_weights: { [DriveType.COGNITIVE]: 0.8 },
      urgency: 0.7,
      expectancy: 0.8,
    });

    assert.ok(desire.id, 'Desire should have an ID');
    assert.equal(desire.goal, 'Test goal');
    assert.equal(desire.status, 'active');

    const ranking = engine.getDesireRanking();
    assert.equal(ranking.length, 1);
    assert.equal(ranking[0].desire.id, desire.id);
    engine.stop();
  });

  it('pursues a desire when score exceeds threshold', async () => {
    const dir = tmpDir(); dirs.push(dir);
    const engine = new DesireEngine({
      dataDir: dir,
      config: TEST_CONFIG,
      contextProvider: mockContextProvider(),
      actionExecutor: mockActionExecutor(0.8),
    });

    engine.createDesire({
      goal: 'High priority task',
      drive_weights: { [DriveType.COGNITIVE]: 0.9 },
      urgency: 0.8,
      expectancy: 0.9,
      predicted_reward: 0.7,
    });

    const decision = await engine.runCycle();
    assert.equal(decision.action, 'pursue');
    assert.ok(decision.desire, 'Should have pursued a desire');
    engine.stop();
  });

  it('emits events during cycle', async () => {
    const dir = tmpDir(); dirs.push(dir);
    const events: EngineEvent[] = [];
    const engine = new DesireEngine({
      dataDir: dir,
      config: TEST_CONFIG,
      contextProvider: mockContextProvider(),
      actionExecutor: mockActionExecutor(),
    });

    engine.on((event) => { events.push(event); });

    engine.createDesire({
      goal: 'Event test',
      drive_weights: { [DriveType.COGNITIVE]: 0.8 },
      urgency: 0.7,
      expectancy: 0.8,
    });

    await engine.runCycle();

    // Should have at least: desire_created + cycle_complete
    const types = events.map(e => e.type);
    assert.ok(types.includes('desire_created'), `Should emit desire_created, got: ${types.join(', ')}`);
    assert.ok(types.includes('cycle_complete'), `Should emit cycle_complete, got: ${types.join(', ')}`);
    engine.stop();
  });

  it('emits voice events', async () => {
    const dir = tmpDir(); dirs.push(dir);
    const voiceMessages: string[] = [];
    const engine = new DesireEngine({
      dataDir: dir,
      config: TEST_CONFIG,
      contextProvider: mockContextProvider(),
      actionExecutor: mockActionExecutor(),
    });

    engine.on((event) => {
      if (event.type === 'voice') {
        voiceMessages.push(event.message.text);
      }
    });

    engine.createDesire({
      goal: 'Voice test desire',
      drive_weights: { [DriveType.COGNITIVE]: 0.8 },
      urgency: 0.7,
      expectancy: 0.8,
    });

    await engine.runCycle();
    assert.ok(voiceMessages.length > 0, `Should emit voice messages, got ${voiceMessages.length}`);
    engine.stop();
  });

  it('getStatus returns correct structure', () => {
    const dir = tmpDir(); dirs.push(dir);
    const engine = new DesireEngine({
      dataDir: dir,
      config: TEST_CONFIG,
      contextProvider: mockContextProvider(),
      actionExecutor: mockActionExecutor(),
    });

    engine.createDesire({ goal: 'Status test', drive_weights: { [DriveType.COGNITIVE]: 0.5 } });

    const status = engine.getStatus();
    assert.ok('state' in status);
    assert.ok('activeDesires' in status);
    assert.ok('totalDesires' in status);
    assert.ok('recentOutcomes' in status);
    assert.ok('running' in status);
    assert.equal(status.activeDesires, 1);
    assert.equal(status.running, false);
    engine.stop();
  });

  it('completeDesire removes from active', () => {
    const dir = tmpDir(); dirs.push(dir);
    const engine = new DesireEngine({
      dataDir: dir,
      config: TEST_CONFIG,
      contextProvider: mockContextProvider(),
      actionExecutor: mockActionExecutor(),
    });

    const desire = engine.createDesire({ goal: 'Complete me' });
    assert.equal(engine.getDesireRanking().length, 1);

    engine.completeDesire(desire.id);
    assert.equal(engine.getDesireRanking().length, 0);
    engine.stop();
  });

  it('abandonDesire emits event and removes from active', () => {
    const dir = tmpDir(); dirs.push(dir);
    const events: EngineEvent[] = [];
    const engine = new DesireEngine({
      dataDir: dir,
      config: TEST_CONFIG,
      contextProvider: mockContextProvider(),
      actionExecutor: mockActionExecutor(),
    });

    engine.on((e) => { events.push(e); });

    const desire = engine.createDesire({ goal: 'Abandon me' });
    engine.abandonDesire(desire.id, 'No longer relevant');

    const abandonEvents = events.filter(e => e.type === 'desire_abandoned');
    assert.equal(abandonEvents.length, 1);
    assert.equal(engine.getDesireRanking().length, 0);
    engine.stop();
  });

  it('updateConfig throws on frozen keys', () => {
    const dir = tmpDir(); dirs.push(dir);
    const engine = new DesireEngine({
      dataDir: dir,
      config: TEST_CONFIG,
      contextProvider: mockContextProvider(),
      actionExecutor: mockActionExecutor(),
    });

    assert.throws(() => {
      engine.updateConfig({
        safety: { max_wanting_score: 999 } as any,
      });
    }, /frozen/i, 'Should throw on frozen config key');
    engine.stop();
  });

  it('updateConfig allows non-frozen keys', () => {
    const dir = tmpDir(); dirs.push(dir);
    const engine = new DesireEngine({
      dataDir: dir,
      config: { ...TEST_CONFIG },
      contextProvider: mockContextProvider(),
      actionExecutor: mockActionExecutor(),
    });

    assert.doesNotThrow(() => {
      engine.updateConfig({
        personality: 'updated-personality',
      });
    });
    engine.stop();
  });

  it('handles action executor failure gracefully', async () => {
    const dir = tmpDir(); dirs.push(dir);
    const engine = new DesireEngine({
      dataDir: dir,
      config: TEST_CONFIG,
      contextProvider: mockContextProvider(),
      actionExecutor: async () => { throw new Error('Executor crashed'); },
    });

    engine.createDesire({
      goal: 'Will fail',
      drive_weights: { [DriveType.COGNITIVE]: 0.9 },
      urgency: 0.9,
      expectancy: 0.9,
    });

    // Should not throw
    const decision = await engine.runCycle();
    assert.equal(decision.action, 'pursue');
    engine.stop();
  });

  it('persists state across engine restarts', async () => {
    const dir = tmpDir(); dirs.push(dir);

    // First engine instance
    const engine1 = new DesireEngine({
      dataDir: dir,
      config: TEST_CONFIG,
      contextProvider: mockContextProvider(),
      actionExecutor: mockActionExecutor(),
    });

    engine1.createDesire({
      goal: 'Persistent desire',
      drive_weights: { [DriveType.COGNITIVE]: 0.8 },
      urgency: 0.7,
      expectancy: 0.8,
    });

    await engine1.runCycle();
    engine1.stop();

    // Wait for debounced save
    await new Promise(r => setTimeout(r, 1500));

    // Second engine instance — should load persisted state
    const engine2 = new DesireEngine({
      dataDir: dir,
      config: TEST_CONFIG,
      contextProvider: mockContextProvider(),
      actionExecutor: mockActionExecutor(),
    });

    const ranking = engine2.getDesireRanking();
    assert.ok(ranking.length > 0, 'Should have persisted desires');
    assert.equal(ranking[0].desire.goal, 'Persistent desire');

    const status = engine2.getStatus();
    assert.ok(status.state.total_cycles > 0, 'Should have persisted cycle count');
    engine2.stop();
  });

  it('expressDesires returns voice message when desires exist', () => {
    const dir = tmpDir(); dirs.push(dir);
    const engine = new DesireEngine({
      dataDir: dir,
      config: TEST_CONFIG,
      contextProvider: mockContextProvider(),
      actionExecutor: mockActionExecutor(),
    });

    engine.createDesire({
      goal: 'Express this desire',
      drive_weights: { [DriveType.COGNITIVE]: 0.8 },
      urgency: 0.7,
    });

    const voice = engine.expressDesires();
    assert.ok(voice, 'Should return a voice message');
    assert.ok(voice!.text.length > 0, 'Voice text should not be empty');
    engine.stop();
  });

  it('notifyActivity resets idle timer', async () => {
    const dir = tmpDir(); dirs.push(dir);
    const engine = new DesireEngine({
      dataDir: dir,
      config: TEST_CONFIG,
      contextProvider: mockContextProvider(),
      actionExecutor: mockActionExecutor(),
    });

    // Run a cycle to advance idle
    await engine.runCycle();
    engine.notifyActivity();

    const status = engine.getStatus();
    assert.equal(status.state.idle_duration_seconds, 0, 'Idle should be reset');
    engine.stop();
  });
});
