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
import { Desire, DesireEngineConfig, EngineState } from '../types.js';
export declare const SAFETY_INVARIANTS: Readonly<{
    WANTING_ABSOLUTE_MAX: 1;
    ADDICTION_DIVERGENCE_THRESHOLD: 0.3;
    BASELINE_MOTIVATION_FLOOR: 0.15;
    OBSESSION_MAX_PURSUITS: 10;
    MAX_ACTIVE_DESIRES_HARD_LIMIT: 100;
    ACTION_THRESHOLD_FLOOR: 0.1;
}>;
export interface SafetyReport {
    issues: SafetyIssue[];
    actions_taken: string[];
    healthy: boolean;
}
export interface SafetyIssue {
    type: 'addiction' | 'depression' | 'helplessness' | 'obsession' | 'starvation' | 'overflow';
    severity: 'low' | 'medium' | 'high';
    description: string;
    desire_id?: string;
}
/**
 * Run all safety checks on the desire system.
 * Returns issues found and actions taken to correct them.
 *
 * This function always enforces SAFETY_INVARIANTS regardless of config values.
 * Config can only make safety _stricter_, never _looser_ than the invariants.
 */
export declare function runSafetyChecks(desires: Desire[], config: DesireEngineConfig, state: EngineState): SafetyReport;
