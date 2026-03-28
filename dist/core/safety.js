/**
 * Safety Mechanisms
 * Prevents AI pathologies: addiction, depression, learned helplessness, OCD, goal starvation.
 *
 * ARCHITECTURE: Safety has two layers:
 * 1. INVARIANTS — hardcoded, cannot be disabled or configured away.
 *    These are the non-negotiable guardrails that prevent catastrophic behavior.
 * 2. CONFIGURABLE — thresholds and policies that can be tuned via config.
 *    These allow personality customization without compromising core safety.
 */
import { DriveType } from '../types.js';
// ============================================================
// Safety Invariants — HARDCODED, not configurable
// These cannot be overridden by config, updateConfig(), or any runtime API.
// Changing these requires a code change (and a review).
// ============================================================
export const SAFETY_INVARIANTS = Object.freeze({
    // Absolute ceiling for wanting_score. No desire can exceed this, ever.
    WANTING_ABSOLUTE_MAX: 1.0,
    // Wanting/liking divergence threshold for addiction detection.
    // 0.3 = 30% range divergence on [0,1] scale. Empirical starting point
    // based on Berridge's wanting/liking separation research — significant
    // divergence indicates pathological pursuit without satisfaction.
    // Tune based on production data.
    ADDICTION_DIVERGENCE_THRESHOLD: 0.3,
    // Absolute floor for baseline_motivation. Prevents total shutdown.
    // 0.15 = 15% of max motivation — enough to keep the agent minimally responsive
    // even after a string of failures, without locking into a depressive loop.
    BASELINE_MOTIVATION_FLOOR: 0.15,
    // Maximum pursuit count before forced review. Prevents infinite loops.
    // 10 pursuits at 5-min cycles = ~50 min of unproductive repetition before intervention.
    OBSESSION_MAX_PURSUITS: 10,
    // Maximum active desires. Prevents unbounded growth.
    MAX_ACTIVE_DESIRES_HARD_LIMIT: 100,
    // Minimum action_threshold. Prevents agent from pursuing everything.
    ACTION_THRESHOLD_FLOOR: 0.1,
});
/**
 * Run all safety checks on the desire system.
 * Returns issues found and actions taken to correct them.
 *
 * This function always enforces SAFETY_INVARIANTS regardless of config values.
 * Config can only make safety _stricter_, never _looser_ than the invariants.
 */
export function runSafetyChecks(desires, config, state) {
    const issues = [];
    const actions = [];
    const activeDesires = desires.filter(d => d.status === 'active');
    // Use stricter of config vs invariant for each threshold
    const wantingMax = Math.min(config.safety.max_wanting_score, SAFETY_INVARIANTS.WANTING_ABSOLUTE_MAX);
    const addictionGap = SAFETY_INVARIANTS.ADDICTION_DIVERGENCE_THRESHOLD;
    const obsessionMax = Math.min(config.safety.max_active_desires > 0 ? 20 : 20, // config might have its own
    SAFETY_INVARIANTS.OBSESSION_MAX_PURSUITS);
    // 1. Anti-addiction: check for wanting score ceiling violations
    for (const d of activeDesires) {
        // INVARIANT: clamp wanting_score to absolute max
        if (d.wanting_score > SAFETY_INVARIANTS.WANTING_ABSOLUTE_MAX) {
            d.wanting_score = SAFETY_INVARIANTS.WANTING_ABSOLUTE_MAX;
            actions.push(`[INVARIANT] Clamped wanting_score for "${d.goal}" to absolute max ${SAFETY_INVARIANTS.WANTING_ABSOLUTE_MAX}`);
        }
        if (d.wanting_score >= wantingMax) {
            // Check wanting/liking divergence using the invariant threshold
            if (d.wanting_score - d.liking_score > addictionGap) {
                issues.push({
                    type: 'addiction',
                    severity: 'high',
                    description: `"${d.goal}" has high wanting (${d.wanting_score.toFixed(2)}) but low liking (${d.liking_score.toFixed(2)}) — addiction pattern (gap: ${(d.wanting_score - d.liking_score).toFixed(2)} > ${addictionGap})`,
                    desire_id: d.id,
                });
                // Cap wanting
                d.wanting_score = wantingMax * 0.8;
                actions.push(`Capped wanting_score for "${d.goal}" to ${d.wanting_score.toFixed(2)}`);
            }
        }
    }
    // 2. Anti-depression: check baseline motivation (#6 escalation added)
    if (state.baseline_motivation < 0.3) {
        // Track how many times we've hit the floor
        state.depression_floor_count = (state.depression_floor_count || 0) + 1;
        const severity = state.baseline_motivation < 0.2 ? 'high' : 'medium';
        issues.push({
            type: 'depression',
            severity,
            description: `Baseline motivation critically low (${state.baseline_motivation.toFixed(2)}), floor hit ${state.depression_floor_count} time(s)`,
        });
        // INVARIANT: enforce absolute floor
        if (state.baseline_motivation < SAFETY_INVARIANTS.BASELINE_MOTIVATION_FLOOR) {
            state.baseline_motivation = SAFETY_INVARIANTS.BASELINE_MOTIVATION_FLOOR + 0.1;
            actions.push(`[INVARIANT] Forced baseline_motivation to ${state.baseline_motivation.toFixed(2)} (above absolute floor)`);
        }
        else if (state.baseline_motivation < 0.2) {
            state.baseline_motivation = 0.25;
            actions.push('Forced baseline_motivation to 0.25 (anti-depression floor)');
        }
        // Escalation: after 3 consecutive floor hits, escalate to critical (#6)
        if (state.depression_floor_count >= 3) {
            issues.push({
                type: 'depression',
                severity: 'high',
                description: `Baseline motivation hit floor ${state.depression_floor_count} consecutive times — requires human intervention`,
            });
            actions.push(`[ESCALATION] Depression floor hit ${state.depression_floor_count}x — emitting critical alert`);
        }
    }
    else {
        // Reset counter when motivation recovers
        state.depression_floor_count = 0;
    }
    // 3. Anti-helplessness: re-evaluate stale low-expectancy desires
    const now = Date.now();
    for (const d of activeDesires) {
        if (d.expectancy < 0.1 && d.last_pursued) {
            const lastPursuedAge = (now - new Date(d.last_pursued).getTime()) / 1000;
            if (lastPursuedAge > config.safety.reeval_interval_seconds) {
                issues.push({
                    type: 'helplessness',
                    severity: 'medium',
                    description: `"${d.goal}" has very low expectancy (${d.expectancy.toFixed(2)}) and hasn't been retried in ${Math.round(lastPursuedAge / 3600)}h — may be learned helplessness`,
                    desire_id: d.id,
                });
                // Reset expectancy to give it another chance
                d.expectancy = 0.3;
                actions.push(`Reset expectancy for "${d.goal}" to 0.3 (anti-helplessness re-eval)`);
            }
        }
    }
    // 4. Anti-obsession: check for desires pursued too many times without completion
    // INVARIANT: uses hardcoded max, not just config
    for (const d of activeDesires) {
        if (d.pursuit_count > obsessionMax && d.liking_score < 0.3) {
            issues.push({
                type: 'obsession',
                severity: 'high',
                description: `"${d.goal}" pursued ${d.pursuit_count} times with low satisfaction (${d.liking_score.toFixed(2)}) — possible obsessive loop (limit: ${obsessionMax})`,
                desire_id: d.id,
            });
            d.status = 'abandoned';
            actions.push(`Abandoned "${d.goal}" after ${d.pursuit_count} unsatisfying pursuits (anti-obsession)`);
        }
    }
    // 5. Drive diversity: ensure multiple drive types are active
    const activeDriveTypes = new Set();
    for (const d of activeDesires) {
        const topDrive = getTopDriveType(d);
        activeDriveTypes.add(topDrive);
    }
    if (activeDesires.length > 3 && activeDriveTypes.size < config.safety.diversity_min_types) {
        issues.push({
            type: 'starvation',
            severity: 'low',
            description: `Only ${activeDriveTypes.size} drive type(s) active — goal diversity too low`,
        });
    }
    // 6. Desire overflow: garbage collect stale desires
    // INVARIANT: hard limit regardless of config
    const maxDesires = Math.min(config.safety.max_active_desires, SAFETY_INVARIANTS.MAX_ACTIVE_DESIRES_HARD_LIMIT);
    if (activeDesires.length > maxDesires) {
        issues.push({
            type: 'overflow',
            severity: 'medium',
            description: `${activeDesires.length} active desires exceeds max of ${maxDesires}`,
        });
        // Expire lowest-motivation desires
        const sorted = [...activeDesires].sort((a, b) => a.wanting_score - b.wanting_score);
        const toExpire = sorted.slice(0, activeDesires.length - maxDesires);
        for (const d of toExpire) {
            d.status = 'expired';
            actions.push(`Expired low-priority desire "${d.goal}" (GC overflow)`);
        }
    }
    // 7. TTL expiry: expire old unfulfilled desires
    for (const d of activeDesires) {
        const age = (now - new Date(d.created_at).getTime()) / 1000;
        if (age > config.safety.desire_ttl_seconds && d.wanting_score < 0.3) {
            d.status = 'expired';
            actions.push(`Expired stale desire "${d.goal}" (age: ${Math.round(age / 3600)}h, low wanting)`);
        }
    }
    return {
        issues,
        actions_taken: actions,
        healthy: issues.filter(i => i.severity === 'high').length === 0,
    };
}
function getTopDriveType(desire) {
    const weights = desire.drive_weights;
    let maxType = DriveType.COGNITIVE;
    let maxWeight = 0;
    for (const [type, weight] of Object.entries(weights)) {
        if (weight > maxWeight) {
            maxWeight = weight;
            maxType = type;
        }
    }
    return maxType;
}
