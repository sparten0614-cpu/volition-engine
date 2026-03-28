/**
 * Drive Generator
 * Produces raw drive signals from internal state, environment, and idle duration.
 * Maps to VTA (dopamine signal source) in the brain.
 */
import { DriveType } from '../types.js';
/**
 * Generate drive signals based on current engine state.
 * Returns an array of active drive signals sorted by intensity.
 *
 * TRUST BOUNDARY (#16): This function trusts the DriveContext provided by the adapter.
 * The adapter is responsible for providing accurate environmental data.
 * If the adapter supplies fabricated data (e.g., always reporting disk=90%),
 * drive priorities will be skewed. Framework users implementing custom adapters
 * should ensure their context providers return honest system state.
 */
export function generateDrives(state, config, context) {
    const signals = [];
    const now = new Date().toISOString();
    // 1. Idle anxiety drive — grows with idle duration
    if (state.idle_duration_seconds > 0) {
        const anxietyIntensity = computeIdleAnxiety(state.idle_duration_seconds, config.drives.idle_anxiety_rate, state.recent_success_rate);
        if (anxietyIntensity > 0.05) {
            signals.push({
                type: DriveType.COGNITIVE,
                source: 'idle_anxiety',
                intensity: anxietyIntensity,
                description: `Idle for ${Math.round(state.idle_duration_seconds / 60)} minutes — drive to find productive work`,
                timestamp: now,
            });
        }
    }
    // 2. Curiosity drives — from stale knowledge domains
    if (context.staleDomains && context.staleDomains.length > 0) {
        for (const domain of context.staleDomains) {
            // Cap staleness at 48h equivalent — beyond that doesn't increase intensity further
            const cappedHours = Math.min(domain.hoursSinceUpdate, 48);
            const staleness = cappedHours / 24; // Normalize to days (max 2)
            const intensity = Math.min(0.7, staleness * config.drives.curiosity_weight * 0.3);
            if (intensity > 0.1) {
                signals.push({
                    type: DriveType.COGNITIVE,
                    source: 'curiosity_gap',
                    intensity,
                    description: `Knowledge about "${domain.name}" is ${Math.round(domain.hoursSinceUpdate)}h stale`,
                    stimulus: domain,
                    timestamp: now,
                });
            }
        }
    }
    // 3. Mastery drives — from detected skill weaknesses
    if (context.skillGaps && context.skillGaps.length > 0) {
        for (const gap of context.skillGaps) {
            const intensity = gap.severity * config.drives.mastery_weight;
            if (intensity > 0.1) {
                signals.push({
                    type: DriveType.SELF_ACTUALIZATION,
                    source: 'mastery_gap',
                    intensity,
                    description: `Skill "${gap.name}" has ${gap.errorRate}% error rate — drive to improve`,
                    stimulus: gap,
                    timestamp: now,
                });
            }
        }
    }
    // 4. Social drives — from pending shareable discoveries
    if (context.pendingDiscoveries && context.pendingDiscoveries.length > 0) {
        for (const discovery of context.pendingDiscoveries) {
            const intensity = discovery.relevance * config.drives.social_weight;
            if (intensity > 0.1) {
                signals.push({
                    type: DriveType.SOCIAL,
                    source: 'sharing_drive',
                    intensity,
                    description: `Found something relevant: "${discovery.title}" — drive to share`,
                    stimulus: discovery,
                    timestamp: now,
                });
            }
        }
    }
    // 4b. Findings-driven sharing — recent research findings create social sharing pressure
    if (context.recentFindings) {
        for (const [desireId, entries] of Object.entries(context.recentFindings)) {
            // Only consider substantive findings (not "no new findings" / duplicate rejections)
            const substantive = entries.filter(e => e.summary.length > 50 &&
                !e.summary.startsWith('No new findings') &&
                !e.summary.startsWith('Rejected') &&
                !e.summary.startsWith('Skipped'));
            if (substantive.length > 0) {
                // Findings age — fresher findings create stronger sharing drive
                const latestTs = new Date(substantive[substantive.length - 1].timestamp).getTime();
                const ageHours = (Date.now() - latestTs) / (1000 * 60 * 60);
                // Intensity peaks when findings are fresh (< 1h), decays over 12h
                const freshnessBoost = Math.max(0, 1 - ageHours / 12);
                const intensity = Math.min(0.7, substantive.length * 0.15 * freshnessBoost);
                if (intensity > 0.1) {
                    signals.push({
                        type: DriveType.SOCIAL,
                        source: 'findings_sharing',
                        intensity,
                        description: `${substantive.length} research finding(s) ready to share (freshness: ${Math.round(freshnessBoost * 100)}%)`,
                        stimulus: { desireId, findingCount: substantive.length, latestAge: ageHours },
                        timestamp: now,
                    });
                }
            }
            // Findings also boost cognitive drive — more findings = more context for next research
            const hasFindings = entries.filter(e => e.summary.length > 50).length > 0;
            if (hasFindings) {
                const cogBoost = Math.min(0.3, entries.length * 0.05);
                if (cogBoost > 0.1) {
                    signals.push({
                        type: DriveType.COGNITIVE,
                        source: 'findings_context',
                        intensity: cogBoost,
                        description: `Previous findings available for desire context — informed research possible`,
                        stimulus: { desireId, totalFindings: entries.length },
                        timestamp: now,
                    });
                }
            }
        }
    }
    // 5. Homeostatic drives — from resource monitoring
    if (context.resourceStatus) {
        const rs = context.resourceStatus;
        // Aggregate system health (insular cortex analog — unified internal state)
        const healthFactors = [
            rs.diskUsagePercent ? Math.max(0, (rs.diskUsagePercent - 70) / 30) : 0,
            rs.memoryUsagePercent ? Math.max(0, (rs.memoryUsagePercent - 70) / 30) : 0,
            rs.contextUsagePercent ? Math.max(0, (rs.contextUsagePercent - 50) / 50) : 0,
        ];
        const systemStress = Math.max(...healthFactors);
        if (systemStress > 0.1) {
            signals.push({
                type: DriveType.HOMEOSTATIC,
                source: 'resource_stress',
                intensity: systemStress,
                description: `System resources stressed (${Math.round(systemStress * 100)}%) — drive to maintain health`,
                stimulus: rs,
                timestamp: now,
            });
        }
    }
    // 6. Reflection drive — periodic strategy review (DMN analog)
    if (state.idle_duration_seconds > config.drives.reflection_interval_seconds) {
        const lastReflectionAge = context.lastReflectionAge || Infinity;
        if (lastReflectionAge > config.drives.reflection_interval_seconds) {
            signals.push({
                type: DriveType.SELF_ACTUALIZATION,
                source: 'reflection_drive',
                intensity: 0.4, // Moderate, not frantic
                description: 'Time for strategic reflection — review recent performance and plan ahead',
                timestamp: now,
            });
        }
    }
    // === Phase 2: Drives from real C4 + Scheduler data ===
    // 7. Communication drive — unanswered messages create social pressure
    if (context.conversationActivity) {
        const ca = context.conversationActivity;
        if (ca.unansweredIncoming > 0) {
            const intensity = Math.min(1, ca.unansweredIncoming * 0.25);
            signals.push({
                type: DriveType.SOCIAL,
                source: 'unanswered_messages',
                intensity,
                description: `${ca.unansweredIncoming} unanswered incoming message(s) — drive to respond`,
                stimulus: { unanswered: ca.unansweredIncoming, channels: ca.channelBreakdown },
                timestamp: now,
            });
        }
        // Low activity drive — if very few conversations, drive to reach out
        if (ca.totalLast24h < 5) {
            signals.push({
                type: DriveType.SOCIAL,
                source: 'low_activity',
                intensity: 0.2,
                description: `Only ${ca.totalLast24h} conversations in 24h — drive to engage`,
                timestamp: now,
            });
        }
    }
    // 8. Owner attention drive — adapt behavior based on owner presence
    if (context.ownerPresence) {
        const op = context.ownerPresence;
        const hoursSinceOwner = op.lastInteractionAgeSeconds / 3600;
        // Owner absent for a long time — lower social sharing drive (no one to share with)
        // But increase self-directed work intensity
        if (hoursSinceOwner > 12 && !op.ownerActiveToday) {
            signals.push({
                type: DriveType.COGNITIVE,
                source: 'autonomous_work',
                intensity: Math.min(0.6, hoursSinceOwner / 48), // Grows slowly, caps at 0.6
                description: `Owner absent ${Math.round(hoursSinceOwner)}h — drive for self-directed productive work`,
                timestamp: now,
            });
        }
        // Owner recently active — boost sharing drive (good time to share findings)
        if (hoursSinceOwner < 2 && op.recentOwnerMessages > 0) {
            signals.push({
                type: DriveType.SOCIAL,
                source: 'owner_available',
                intensity: 0.35,
                description: 'Owner recently active — good time to share findings',
                timestamp: now,
            });
        }
    }
    // 9. Task health drive — scheduler failures create maintenance pressure
    if (context.schedulerStatus) {
        const ss = context.schedulerStatus;
        // High failure rate — something is wrong with task execution
        if (ss.failedRecent > 2 && ss.successRate < 0.7) {
            signals.push({
                type: DriveType.HOMEOSTATIC,
                source: 'task_health',
                intensity: Math.min(0.8, (1 - ss.successRate) * 0.8 + 0.1),
                description: `Task success rate ${Math.round(ss.successRate * 100)}% (${ss.failedRecent} failures) — drive to investigate and fix`,
                stimulus: { successRate: ss.successRate, failed: ss.failedRecent },
                timestamp: now,
            });
        }
        // Overdue tasks create urgency
        if (ss.overdueCount > 0) {
            signals.push({
                type: DriveType.HOMEOSTATIC,
                source: 'overdue_tasks',
                intensity: Math.min(0.7, ss.overdueCount * 0.2),
                description: `${ss.overdueCount} overdue task(s) in scheduler — drive to clear backlog`,
                timestamp: now,
            });
        }
    }
    // Sort by intensity descending
    signals.sort((a, b) => b.intensity - a.intensity);
    return signals;
}
/**
 * Compute idle anxiety using a sigmoid curve.
 * Starts gentle, accelerates, then plateaus.
 * Recent success dampens anxiety (you've been productive, relax a bit).
 */
function computeIdleAnxiety(idleSeconds, anxietyRate, recentSuccessRate) {
    const idleMinutes = idleSeconds / 60;
    // Sigmoid: starts slow, accelerates around midpoint, plateaus at max
    // midpoint = 30 minutes by default, scaled by anxiety_rate
    const midpoint = 30 / anxietyRate;
    const steepness = 0.05 * anxietyRate;
    const rawAnxiety = 1 / (1 + Math.exp(-steepness * (idleMinutes - midpoint)));
    // Dampen by recent success (high success = less anxiety)
    const dampening = 1 - (recentSuccessRate * 0.3);
    return Math.min(1, rawAnxiety * dampening);
}
