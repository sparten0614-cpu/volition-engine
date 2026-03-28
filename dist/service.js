#!/usr/bin/env node
/**
 * Volition Service — Long-running PM2 process.
 * Runs the desire engine cycle on an interval, logging decisions and acting on desires.
 * Phase 3: Also listens for desire-outcome messages from remote executors via C4.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { createZylosDesireEngine, storeFindingsSummary } from './zylos-adapter.js';
import { RewardSource } from './types.js';
const CYCLE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes between cycles
const ZYLOS_ROOT = process.env.ZYLOS_ROOT || path.join(process.env.HOME || '/Users/mini1', 'zylos');
const C4_DB = path.join(ZYLOS_ROOT, 'comm-bridge', 'c4.db');
const engine = createZylosDesireEngine({ cycleIntervalMs: CYCLE_INTERVAL_MS });
// Enhanced event logging for service mode
engine.on((event) => {
    const ts = new Date().toISOString();
    switch (event.type) {
        case 'cycle_complete':
            console.log(`[${ts}] cycle #${event.cycle}: ${event.decision.action} — ${event.decision.reason}`);
            if (!event.safety.healthy) {
                console.log(`[${ts}] ⚠ safety: ${event.safety.issues.map(i => `${i.type}(${i.severity})`).join(', ')}`);
            }
            break;
        case 'desire_created':
            console.log(`[${ts}] new desire: "${event.desire.goal}" (wanting: ${event.desire.wanting_score.toFixed(2)})`);
            break;
        case 'mode_changed':
            console.log(`[${ts}] mode: ${event.from} → ${event.to}`);
            break;
        case 'approval_needed':
            console.log(`[${ts}] ⏸ approval needed: "${event.desire.goal}" (score: ${(event.score * 100).toFixed(0)}%)`);
            break;
        case 'safety_alert':
            console.log(`[${ts}] 🚨 safety alert: ${event.report.issues.length} issues, ${event.report.actions_taken.length} actions taken`);
            break;
    }
});
// ============================================================
// C4 Outcome Listener — polls for desire-outcome messages
// ============================================================
let lastCheckedId = 0;
const processedOutcomeIds = new Set();
function pollForOutcomes() {
    try {
        if (!fs.existsSync(C4_DB))
            return;
        const sql = `PRAGMA busy_timeout=5000; SELECT id, content FROM conversations WHERE direction = 'in' AND id > ${lastCheckedId} AND content LIKE '%desire-outcome%' ORDER BY id ASC LIMIT 10`;
        const raw = execSync(`sqlite3 "${C4_DB}" "${sql}"`, { encoding: 'utf-8', timeout: 5000 }).trim();
        // Skip PRAGMA output line
        const lines = raw.split('\n');
        const dataLines = lines.filter((l) => l.includes('|') && !(/^\d+$/.test(l)));
        for (const line of dataLines) {
            const pipeIdx = line.indexOf('|');
            if (pipeIdx === -1)
                continue;
            const idStr = line.substring(0, pipeIdx);
            const content = line.substring(pipeIdx + 1);
            const msgId = parseInt(idStr, 10);
            if (isNaN(msgId))
                continue;
            lastCheckedId = Math.max(lastCheckedId, msgId);
            // Dedup: skip already-processed outcomes
            if (processedOutcomeIds.has(msgId))
                continue;
            // Try to parse the desire-outcome from the message content
            try {
                const msg = extractOutcomeMessage(content);
                if (msg) {
                    console.log(`[Volition] Received desire-outcome from ${msg.executor_id} for desire ${msg.desire_id} (c4_id=${msgId})`);
                    engine.handleRemoteOutcome(msg);
                    processedOutcomeIds.add(msgId);
                    // Store findings if present
                    if (msg.findings_summary) {
                        storeFindingsSummary(msg.desire_id, msg.executor_id, msg.findings_summary);
                    }
                }
            }
            catch (err) {
                console.error(`[Volition] Failed to parse outcome message (id=${msgId}):`, err.message);
            }
        }
    }
    catch {
        // Non-critical — will retry next poll
    }
}
/**
 * Extract a DesireOutcomeMessage from C4 message content.
 * The message might be wrapped in various formats — try JSON parse first.
 */
function extractOutcomeMessage(content) {
    // Try direct JSON parse
    try {
        const parsed = JSON.parse(content);
        if (parsed.type === 'desire-outcome' && parsed.desire_id && parsed.executor_id) {
            return {
                type: 'desire-outcome',
                desire_id: parsed.desire_id,
                executor_id: parsed.executor_id,
                success: !!parsed.success,
                reward: Math.max(0, Math.min(1, parseFloat(parsed.reward) || 0.5)),
                reward_source: parsed.reward_source || RewardSource.SELF_EVAL,
                action_description: parsed.action_description || '',
                findings_summary: parsed.findings_summary,
            };
        }
    }
    catch { /* not direct JSON */ }
    // Try to find JSON object within the content
    const jsonMatch = content.match(/\{[^{}]*"type"\s*:\s*"desire-outcome"[^{}]*\}/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.desire_id && parsed.executor_id) {
                return {
                    type: 'desire-outcome',
                    desire_id: parsed.desire_id,
                    executor_id: parsed.executor_id,
                    success: !!parsed.success,
                    reward: Math.max(0, Math.min(1, parseFloat(parsed.reward) || 0.5)),
                    reward_source: parsed.reward_source || RewardSource.SELF_EVAL,
                    action_description: parsed.action_description || '',
                    findings_summary: parsed.findings_summary,
                };
            }
        }
        catch { /* skip */ }
    }
    return null;
}
// Initialize lastCheckedId — backtrack 50 messages to catch any missed near restart
try {
    if (fs.existsSync(C4_DB)) {
        const maxId = execSync(`sqlite3 "${C4_DB}" "SELECT COALESCE(MAX(id), 0) FROM conversations"`, { encoding: 'utf-8', timeout: 5000 }).trim();
        const max = parseInt(maxId, 10) || 0;
        lastCheckedId = Math.max(0, max - 50); // Backtrack 50 to catch near-restart messages
        console.log(`[Volition] C4 outcome listener initialized, scanning from id ${lastCheckedId} (max: ${max})`);
    }
}
catch {
    console.log('[Volition] C4 database not available, outcome listener will retry');
}
// Poll for outcomes every 30 seconds
const outcomePoller = setInterval(pollForOutcomes, 30_000);
// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[Volition] Shutting down gracefully...');
    clearInterval(outcomePoller);
    engine.stop();
    process.exit(0);
});
process.on('SIGTERM', () => {
    console.log('[Volition] SIGTERM received, shutting down...');
    clearInterval(outcomePoller);
    engine.stop();
    process.exit(0);
});
// Start
console.log(`[Volition] Starting desire engine (cycle interval: ${CYCLE_INTERVAL_MS / 1000}s)`);
console.log(`[Volition] Registered executors: ${engine.getOnlineExecutors().map(e => e.display_name).join(', ')}`);
console.log(`[Volition] Status: ${JSON.stringify(engine.getStatus())}`);
engine.start();
