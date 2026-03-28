/**
 * Desire Engine — Main Cycle
 * Orchestrates the full desire lifecycle: sense → evaluate → decide → act → learn.
 *
 * Brain analogy: This is the "consciousness loop" —
 * the thalamo-cortical cycle that integrates all subsystems into coherent behavior.
 */
import { DesireEngineConfig, Desire, EngineState, EngineMode, DriveSignal, OutcomeRecord, RewardSource, ExecutorInfo, DesireOutcomeMessage } from './types.js';
import { DriveContext } from './core/drive-generator.js';
import { PlanDecision } from './core/executive-planner.js';
import { SafetyReport } from './core/safety.js';
import { DesireStore } from './store/desire-store.js';
import { VoiceMessage } from './core/voice.js';
export type EngineEvent = {
    type: 'cycle_complete';
    decision: PlanDecision;
    safety: SafetyReport;
    cycle: number;
} | {
    type: 'desire_created';
    desire: Desire;
} | {
    type: 'desire_completed';
    desire: Desire;
    outcome: OutcomeRecord;
} | {
    type: 'desire_abandoned';
    desire: Desire;
    reason: string;
} | {
    type: 'mode_changed';
    from: EngineMode;
    to: EngineMode;
} | {
    type: 'approval_needed';
    desire: Desire;
    score: number;
} | {
    type: 'safety_alert';
    report: SafetyReport;
} | {
    type: 'explore';
    signals: DriveSignal[];
} | {
    type: 'reflect';
    state: EngineState;
} | {
    type: 'voice';
    message: VoiceMessage;
};
export type EventHandler = (event: EngineEvent) => void | Promise<void>;
export type ContextProvider = () => DriveContext | Promise<DriveContext>;
export type ActionExecutor = (desire: Desire, decision: PlanDecision) => Promise<ActionResult>;
export interface ActionResult {
    success: boolean;
    reward: number;
    reward_source: RewardSource;
    action_description: string;
    context?: Record<string, any>;
}
export declare class DesireEngine {
    private store;
    private config;
    private handlers;
    private contextProvider;
    private actionExecutor;
    private running;
    private cycleTimer;
    private cycleIntervalMs;
    private voice;
    private executorRegistry;
    constructor(opts: {
        dataDir: string;
        config: DesireEngineConfig;
        contextProvider: ContextProvider;
        actionExecutor: ActionExecutor;
        cycleIntervalMs?: number;
        voiceMinCycles?: number;
    });
    /**
     * Start the desire engine cycle loop.
     */
    start(): void;
    /**
     * Stop the engine gracefully.
     */
    stop(): void;
    /**
     * Run a single desire cycle (can be called externally for manual stepping).
     */
    runCycle(): Promise<PlanDecision>;
    private executeDecision;
    private scheduleNextCycle;
    /**
     * Create a new desire from external stimulus (user request, scheduled task, etc.)
     */
    createDesire(params: Parameters<DesireStore['createDesire']>[0]): Desire;
    /**
     * Report an outcome for a desire (from external evaluation).
     */
    reportOutcome(desireId: string, reward: number, source: RewardSource, actionDescription: string): OutcomeRecord | null;
    /**
     * Mark a desire as completed from outside.
     */
    completeDesire(desireId: string): void;
    /**
     * Abandon a desire with a reason.
     */
    abandonDesire(desireId: string, reason: string): void;
    /**
     * Get current engine state for diagnostics.
     */
    getStatus(): {
        state: EngineState;
        activeDesires: number;
        totalDesires: number;
        recentOutcomes: OutcomeRecord[];
        running: boolean;
    };
    /**
     * Get all active desires with their computed motivation scores.
     */
    getDesireRanking(): Array<{
        desire: Desire;
        score: number;
        probability: number;
    }>;
    /**
     * Notify the engine that a user interaction happened (resets idle).
     */
    notifyActivity(): void;
    /**
     * Update config at runtime (e.g., personality tuning).
     * Safety-critical keys are frozen and cannot be modified.
     * Throws if attempting to modify a frozen key.
     */
    updateConfig(updates: Partial<DesireEngineConfig>): void;
    /**
     * Get the underlying store (for advanced operations).
     */
    getStore(): DesireStore;
    registerExecutor(info: ExecutorInfo): void;
    getExecutor(executorId: string): ExecutorInfo | undefined;
    getOnlineExecutors(): ExecutorInfo[];
    /**
     * Select the best executor for a desire based on capabilities and per-executor metrics.
     */
    selectExecutor(desire: Desire): ExecutorInfo | null;
    /**
     * Handle outcome from a remote executor (received via C4).
     */
    handleRemoteOutcome(msg: DesireOutcomeMessage): void;
    on(handler: EventHandler): () => void;
    private emit;
    /**
     * Get what the agent currently wants most — as a human-readable message.
     * Call this periodically or on demand to let the agent express its desires.
     */
    expressDesires(): VoiceMessage | null;
}
