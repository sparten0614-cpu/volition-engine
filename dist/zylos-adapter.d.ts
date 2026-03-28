/**
 * Zylos Integration Adapter
 * Connects the Desire Engine to Zylos infrastructure:
 * - Scheduler (C5): schedule desire-driven tasks
 * - Memory: read context for drive generation
 * - Comm-bridge (C4): report to owner, request approvals
 *
 * This is the "spinal cord" — translating engine decisions into real-world actions.
 */
import { DesireEngine, EngineEvent, ActionResult, ContextProvider } from './engine.js';
import { DesireEngineConfig, Desire, ExecutorInfo } from './types.js';
import { PlanDecision } from './core/executive-planner.js';
export declare function loadConfig(configPath?: string): DesireEngineConfig;
export declare function createZylosContextProvider(): ContextProvider;
export declare function createZylosActionExecutor(opts?: {
    getRemoteExecutor?: (desire: Desire) => ExecutorInfo | null;
}): (desire: Desire, decision: PlanDecision) => Promise<ActionResult>;
export interface FindingsEntry {
    desire_id: string;
    executor_id: string;
    summary: string;
    timestamp: string;
}
/**
 * Dispatch a desire-task to a remote executor via C4.
 * Returns a "dispatched" result — actual outcome arrives later via C4 callback.
 */
export declare function dispatchToRemoteExecutor(desire: Desire, executor: ExecutorInfo): Promise<ActionResult>;
/**
 * Store findings from a remote executor's outcome for memory chaining.
 */
export declare function storeFindingsSummary(desireId: string, executorId: string, summary: string): void;
/**
 * Load recent findings for a desire (for context injection).
 */
export declare function getRecentFindings(desireId: string, limit?: number): FindingsEntry[];
export declare function createZylosEventHandler(): (event: EngineEvent) => void;
export declare function createZylosDesireEngine(opts?: {
    cycleIntervalMs?: number;
    configPath?: string;
}): DesireEngine;
