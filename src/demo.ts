#!/usr/bin/env npx tsx
/**
 * Volition Demo — watch an AI agent's motivation system in real-time.
 *
 * This demo creates a simulated agent with desires and runs 10 cycles,
 * showing how the engine decides what to pursue, when to explore,
 * and how it learns from outcomes.
 *
 * Usage: npx volition-demo
 *        npx tsx src/demo.ts
 */

import { DesireEngine } from './engine.js';
import { DriveType, RiskLevel, DesireEngineConfig, Desire, RewardSource } from './types.js';
import type { DriveContext } from './core/drive-generator.js';
import type { PlanDecision } from './core/executive-planner.js';
import type { ActionResult } from './engine.js';

// ============================================================
// Default config (good for demo — faster learning, visible changes)
// ============================================================

const DEMO_CONFIG: DesireEngineConfig = {
  personality: 'curious-explorer',
  drives: {
    idle_anxiety_rate: 0.15,
    action_threshold: 0.20,
    curiosity_weight: 0.7,
    mastery_weight: 0.5,
    social_weight: 0.4,
    reflection_interval_seconds: 60,
  },
  learning: {
    rpe_learning_rate: 0.15,
    reinforcement_rate: 0.1,
    habituation_rate: 0.02,
    min_learning_rate: 0.05,
    max_learning_rate: 0.3,
  },
  safety: {
    max_wanting_score: 0.95,
    min_activity_interval_seconds: 300,
    reeval_interval_seconds: 600,
    diversity_min_types: 2,
    max_active_desires: 20,
    desire_ttl_seconds: 86400,
  },
  risk_gate: {
    low_risk_autonomous: true,
    medium_risk_notify: true,
    high_risk_approval: true,
  },
  temporal: {
    discount_rate: 0.05,
    urgency_boost_near_deadline: 1.5,
  },
};

// ============================================================
// Mock context provider — simulates an agent's environment
// ============================================================

function createDemoContextProvider(): () => Promise<DriveContext> {
  let cycle = 0;

  return async (): Promise<DriveContext> => {
    cycle++;
    return {
      resourceStatus: {
        diskUsagePercent: 45 + cycle * 2,  // Slowly filling disk
        memoryUsagePercent: 60,
      },
      staleDomains: cycle > 3 ? [
        { name: 'market research', hoursSinceUpdate: 72 },
      ] : undefined,
      lastReflectionAge: cycle * 120,  // Growing time since reflection
    };
  };
}

// ============================================================
// Mock action executor — simulates executing desire actions
// ============================================================

function createDemoActionExecutor(): (desire: Desire, decision: PlanDecision) => Promise<ActionResult> {
  return async (desire: Desire, _decision: PlanDecision): Promise<ActionResult> => {
    // Simulate different outcomes based on desire type
    const topDrive = Object.entries(desire.drive_weights)
      .sort(([, a], [, b]) => b - a)[0]?.[0];

    const outcomes: Record<string, { reward: number; desc: string }> = {
      [DriveType.COGNITIVE]: {
        reward: 0.5 + Math.random() * 0.4,  // 0.5-0.9 — research usually works
        desc: `Researched: ${desire.goal}`,
      },
      [DriveType.SOCIAL]: {
        reward: 0.3 + Math.random() * 0.5,  // 0.3-0.8 — social is unpredictable
        desc: `Shared findings about: ${desire.goal}`,
      },
      [DriveType.HOMEOSTATIC]: {
        reward: 0.6 + Math.random() * 0.3,  // 0.6-0.9 — maintenance is reliable
        desc: `Maintained: ${desire.goal}`,
      },
      [DriveType.SELF_ACTUALIZATION]: {
        reward: 0.4 + Math.random() * 0.4,  // 0.4-0.8 — self-improvement varies
        desc: `Improved: ${desire.goal}`,
      },
    };

    const outcome = outcomes[topDrive || DriveType.COGNITIVE];

    return {
      success: outcome.reward > 0.4,
      reward: outcome.reward,
      reward_source: RewardSource.COMPLETION,
      action_description: outcome.desc,
    };
  };
}

// ============================================================
// Pretty printer
// ============================================================

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function bar(value: number, width = 20): string {
  const filled = Math.round(value * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log(`
${COLORS.bold}${COLORS.cyan}╔══════════════════════════════════════════════════════╗
║           🧠  VOLITION ENGINE  — Live Demo           ║
║     From tasks to desires. A motivation engine.      ║
╚══════════════════════════════════════════════════════╝${COLORS.reset}
`);

  // Create engine with temporary data dir
  const os = await import('os');
  const fs = await import('fs');
  const path = await import('path');
  const dataDir = path.join(os.tmpdir(), 'volition-demo-' + Date.now());
  fs.mkdirSync(dataDir, { recursive: true });

  const engine = new DesireEngine({
    dataDir,
    config: DEMO_CONFIG,
    contextProvider: createDemoContextProvider(),
    actionExecutor: createDemoActionExecutor(),
  });

  // Listen to events
  engine.on((event) => {
    switch (event.type) {
      case 'mode_changed':
        console.log(`  ${COLORS.magenta}⚡ Mode: ${event.from} → ${event.to}${COLORS.reset}`);
        break;
      case 'desire_created':
        console.log(`  ${COLORS.green}✨ New desire: "${event.desire.goal}" (wanting: ${event.desire.wanting_score.toFixed(2)})${COLORS.reset}`);
        break;
      case 'safety_alert':
        console.log(`  ${COLORS.red}⚠️  Safety: ${event.report.issues.map(i => i.type).join(', ')}${COLORS.reset}`);
        break;
      case 'approval_needed':
        console.log(`  ${COLORS.yellow}🔒 Blocked — needs human approval: "${event.desire.goal}"${COLORS.reset}`);
        break;
      case 'voice':
        console.log(`  ${COLORS.magenta}💭 Inner voice:${COLORS.reset} ${COLORS.dim}"${event.message.text}"${COLORS.reset}`);
        break;
    }
  });

  // Seed desires
  console.log(`${COLORS.bold}📝 Creating desires...${COLORS.reset}\n`);

  engine.createDesire({
    goal: 'Research latest AI agent frameworks',
    description: 'Survey GitHub trending, HackerNews, and arxiv for new agent tools',
    drive_weights: { [DriveType.COGNITIVE]: 0.8, [DriveType.SELF_ACTUALIZATION]: 0.3 },
    source: 'internal',
    risk_level: RiskLevel.LOW,
    urgency: 0.7,
    expectancy: 0.8,
    predicted_reward: 0.7,
  });

  engine.createDesire({
    goal: 'Share an interesting discovery with the team',
    description: 'Find and share something valuable proactively',
    drive_weights: { [DriveType.SOCIAL]: 0.7, [DriveType.COGNITIVE]: 0.4 },
    source: 'internal',
    risk_level: RiskLevel.MEDIUM,
    urgency: 0.5,
    expectancy: 0.7,
    predicted_reward: 0.6,
  });

  engine.createDesire({
    goal: 'Clean up stale cache files',
    description: 'Detect and remove expired temporary data',
    drive_weights: { [DriveType.HOMEOSTATIC]: 0.9 },
    source: 'internal',
    risk_level: RiskLevel.LOW,
    urgency: 0.6,
    expectancy: 0.9,
    predicted_reward: 0.8,
  });

  engine.createDesire({
    goal: 'Optimize response latency',
    description: 'Profile and improve slow code paths',
    drive_weights: { [DriveType.SELF_ACTUALIZATION]: 0.7, [DriveType.HOMEOSTATIC]: 0.3 },
    source: 'internal',
    risk_level: RiskLevel.HIGH,  // Code changes = needs approval
    urgency: 0.4,
    expectancy: 0.6,
    predicted_reward: 0.7,
  });

  // Run cycles
  console.log(`\n${COLORS.bold}🏃 Running 10 desire cycles...${COLORS.reset}\n`);
  console.log(`${COLORS.dim}Watch how the engine decides what to pursue, learns from outcomes,`);
  console.log(`and adapts its behavior over time.${COLORS.reset}\n`);

  for (let i = 0; i < 10; i++) {
    const decision = await engine.runCycle();
    const status = engine.getStatus();

    // Cycle header
    console.log(`${COLORS.bold}── Cycle ${i + 1} ──────────────────────────────────────${COLORS.reset}`);
    console.log(`  ${COLORS.dim}Action:${COLORS.reset} ${COLORS.cyan}${decision.action}${COLORS.reset} — ${decision.reason}`);
    console.log(`  ${COLORS.dim}Mode:${COLORS.reset}   ${status.state.mode}`);
    console.log(`  ${COLORS.dim}Baseline motivation:${COLORS.reset} ${bar(status.state.baseline_motivation)} ${(status.state.baseline_motivation * 100).toFixed(0)}%`);

    // Show desire ranking
    const ranking = engine.getDesireRanking();
    if (ranking.length > 0) {
      console.log(`  ${COLORS.dim}Desire ranking:${COLORS.reset}`);
      for (const { desire, score } of ranking.slice(0, 4)) {
        const scoreColor = score > 0.5 ? COLORS.green : score > 0.3 ? COLORS.yellow : COLORS.dim;
        console.log(`    ${scoreColor}${bar(score, 15)} ${(score * 100).toFixed(0)}%${COLORS.reset} ${desire.goal}`);
      }
    }

    // Show last outcome if pursue
    if (decision.action === 'pursue' && status.recentOutcomes.length > 0) {
      const last = status.recentOutcomes[status.recentOutcomes.length - 1];
      const rpeColor = last.rpe > 0 ? COLORS.green : last.rpe < -0.1 ? COLORS.red : COLORS.yellow;
      console.log(`  ${COLORS.dim}RPE:${COLORS.reset} ${rpeColor}${last.rpe > 0 ? '+' : ''}${last.rpe.toFixed(3)}${COLORS.reset} ${COLORS.dim}(predicted: ${last.predicted_reward.toFixed(2)}, actual: ${last.actual_reward.toFixed(2)})${COLORS.reset}`);
    }

    console.log('');
    await new Promise(r => setTimeout(r, 300));
  }

  // Final summary
  const finalStatus = engine.getStatus();
  const finalRanking = engine.getDesireRanking();

  console.log(`${COLORS.bold}${COLORS.cyan}╔══════════════════════════════════════════════════════╗
║                    📊  Summary                        ║
╚══════════════════════════════════════════════════════╝${COLORS.reset}
`);
  console.log(`  Mode:                ${finalStatus.state.mode}`);
  console.log(`  Baseline motivation: ${bar(finalStatus.state.baseline_motivation)} ${(finalStatus.state.baseline_motivation * 100).toFixed(0)}%`);
  console.log(`  Success rate:        ${bar(finalStatus.state.recent_success_rate)} ${(finalStatus.state.recent_success_rate * 100).toFixed(0)}%`);
  console.log(`  Active desires:      ${finalStatus.activeDesires}`);
  console.log(`  Total cycles:        ${finalStatus.state.total_cycles}`);

  if (finalRanking.length > 0) {
    console.log(`\n  ${COLORS.bold}Final desire ranking:${COLORS.reset}`);
    for (const { desire, score } of finalRanking) {
      const wanting = desire.wanting_score;
      const liking = desire.liking_score;
      console.log(`    ${bar(score, 15)} ${(score * 100).toFixed(0)}% — ${desire.goal}`);
      console.log(`    ${COLORS.dim}  wanting: ${wanting.toFixed(2)}  liking: ${liking.toFixed(2)}  pursuits: ${desire.pursuit_count}${COLORS.reset}`);
    }
  }

  // Show wanting/liking divergence if any
  for (const { desire } of finalRanking) {
    const divergence = Math.abs(desire.wanting_score - desire.liking_score);
    if (divergence > 0.2) {
      const label = desire.wanting_score > desire.liking_score
        ? '⚠️  High wanting, low liking — potential addiction pattern'
        : '💡 Low wanting, high liking — undervalued goal';
      console.log(`\n  ${COLORS.yellow}${label}: "${desire.goal}"${COLORS.reset}`);
      console.log(`  ${COLORS.dim}  wanting: ${desire.wanting_score.toFixed(2)} vs liking: ${desire.liking_score.toFixed(2)} (divergence: ${divergence.toFixed(2)})${COLORS.reset}`);
    }
  }

  // Show what the agent currently wants
  const innerVoice = engine.expressDesires();
  if (innerVoice) {
    console.log(`\n${COLORS.bold}${COLORS.magenta}💭 What I want right now:${COLORS.reset}`);
    console.log(`  ${COLORS.dim}"${innerVoice.text}"${COLORS.reset}`);
  }

  console.log(`\n${COLORS.bold}${COLORS.green}✅ Demo complete.${COLORS.reset}`);
  console.log(`${COLORS.dim}Learn more: https://github.com/volition-engine/volition${COLORS.reset}\n`);

  // Cleanup
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
}

main().catch(err => {
  console.error('Demo failed:', err);
  process.exit(1);
});
