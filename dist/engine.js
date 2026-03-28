/**
 * Desire Engine — Main Cycle
 * Orchestrates the full desire lifecycle: sense → evaluate → decide → act → learn.
 *
 * Brain analogy: This is the "consciousness loop" —
 * the thalamo-cortical cycle that integrates all subsystems into coherent behavior.
 */
import { EngineMode, RewardSource, DriveType } from './types.js';
import { generateDrives } from './core/drive-generator.js';
import { rankDesires } from './core/salience-calculator.js';
import { planNextAction } from './core/executive-planner.js';
import { evaluateOutcome } from './core/outcome-evaluator.js';
import { runSafetyChecks, SAFETY_INVARIANTS } from './core/safety.js';
import { DesireStore } from './store/desire-store.js';
import { VoiceGenerator } from './core/voice.js';
// ============================================================
// Frozen config keys — cannot be modified at runtime
// ============================================================
const FROZEN_CONFIG_PATHS = new Set([
    'safety.max_wanting_score',
    'safety.max_active_desires',
    'safety.diversity_min_types',
    'risk_gate.high_risk_approval',
]);
// ============================================================
// Engine
// ============================================================
export class DesireEngine {
    store;
    config;
    handlers = [];
    contextProvider;
    actionExecutor;
    running = false;
    cycleTimer = null;
    cycleIntervalMs;
    voice;
    executorRegistry = new Map();
    constructor(opts) {
        this.store = new DesireStore(opts.dataDir);
        this.config = opts.config;
        this.contextProvider = opts.contextProvider;
        this.actionExecutor = opts.actionExecutor;
        this.cycleIntervalMs = opts.cycleIntervalMs ?? 60_000; // Default: 1 minute
        this.voice = new VoiceGenerator({
            minCyclesBetweenMessages: opts.voiceMinCycles ?? 1,
        });
    }
    // ============================================================
    // Lifecycle
    // ============================================================
    /**
     * Start the desire engine cycle loop.
     */
    start() {
        if (this.running)
            return;
        this.running = true;
        this.emit({ type: 'mode_changed', from: EngineMode.WAITING, to: EngineMode.ACTIVE });
        this.scheduleNextCycle(0); // Run first cycle immediately
    }
    /**
     * Stop the engine gracefully.
     */
    stop() {
        this.running = false;
        if (this.cycleTimer) {
            clearTimeout(this.cycleTimer);
            this.cycleTimer = null;
        }
        this.store.flush(); // Force immediate write on shutdown
    }
    /**
     * Run a single desire cycle (can be called externally for manual stepping).
     */
    async runCycle() {
        const state = this.store.getState();
        const prevMode = state.mode;
        // 1. Update idle tracking
        this.store.updateIdleTime();
        // 2. Sense: gather drive context from environment
        const context = await this.contextProvider();
        // 3. Generate drive signals
        const signals = generateDrives(state, this.config, context);
        // 4. Safety checks
        const desires = this.store.getAllDesires();
        const safety = runSafetyChecks(desires, this.config, state);
        if (!safety.healthy) {
            this.emit({ type: 'safety_alert', report: safety });
        }
        // 5. Plan: decide what to do
        const activeDesires = this.store.getActiveDesires();
        const decision = planNextAction(activeDesires, signals, this.config, state);
        // 6. Mode transition
        if (decision.mode !== prevMode) {
            this.store.updateState({ mode: decision.mode });
            this.emit({ type: 'mode_changed', from: prevMode, to: decision.mode });
        }
        // 7. Execute based on decision
        await this.executeDecision(decision, signals, state);
        // 8. Update cycle stats
        const totalCycles = state.total_cycles + 1;
        this.store.updateState({
            total_cycles: totalCycles,
            last_cycle_at: new Date().toISOString(),
        });
        // 9. Emit cycle complete
        this.emit({ type: 'cycle_complete', decision, safety, cycle: totalCycles });
        return decision;
    }
    // ============================================================
    // Decision execution
    // ============================================================
    async executeDecision(decision, signals, state) {
        switch (decision.action) {
            case 'pursue': {
                if (!decision.desire)
                    break;
                // Reset idle timer — we're doing something
                this.store.resetIdle();
                // Execute the action via the adapter
                try {
                    const result = await this.actionExecutor(decision.desire, decision);
                    // Validate executor return values (trust boundary — #4)
                    const validatedReward = Math.max(0, Math.min(1, result.reward));
                    if (validatedReward !== result.reward) {
                        console.warn(`[DesireEngine] Executor returned out-of-range reward ${result.reward}, clamped to ${validatedReward}`);
                    }
                    const validatedDescription = (result.action_description || '').slice(0, 500);
                    // Phase 2 fix: detect dedup actions — they should not affect
                    // success_rate or baseline_motivation (they're not real executions)
                    const isDedup = validatedDescription.includes('Already scheduled recently');
                    // Learn from the outcome (skip RPE learning for dedup)
                    const outcome = isDedup
                        ? {
                            desire_id: decision.desire.id,
                            predicted_reward: decision.desire.predicted_reward,
                            actual_reward: validatedReward,
                            rpe: 0,
                            reward_source: result.reward_source,
                            action_taken: validatedDescription,
                            timestamp: new Date().toISOString(),
                        }
                        : evaluateOutcome(decision.desire, validatedReward, result.reward_source, validatedDescription, this.config, state);
                    this.store.addOutcome(outcome);
                    this.store.save(); // Persist updated desire state
                    // Check if desire should be completed
                    if (result.success && decision.desire.pursuit_count >= 1 && result.reward > 0.7) {
                        // High reward + success = check if goal is achieved
                        // (Leave this to the action executor to signal via desire status)
                    }
                    this.emit({ type: 'desire_completed', desire: decision.desire, outcome });
                }
                catch (err) {
                    // Hard failure (exception/crash) → reward=0, not 0.1 (#5)
                    // Soft failures (executed but poor result) return low reward via normal path.
                    const outcome = evaluateOutcome(decision.desire, 0, RewardSource.COMPLETION, `Hard failure: ${(err.message || 'unknown error').slice(0, 200)}`, this.config, state);
                    this.store.addOutcome(outcome);
                    this.store.save();
                }
                break;
            }
            case 'explore': {
                this.store.resetIdle();
                this.emit({ type: 'explore', signals });
                break;
            }
            case 'reflect': {
                this.store.resetIdle();
                this.emit({ type: 'reflect', state: { ...state } });
                break;
            }
            case 'blocked': {
                if (decision.desire && decision.score !== undefined) {
                    this.emit({
                        type: 'approval_needed',
                        desire: decision.desire,
                        score: decision.score,
                    });
                }
                break;
            }
            case 'wait':
            default:
                // Do nothing — idle continues to build
                break;
        }
    }
    // ============================================================
    // Timer
    // ============================================================
    scheduleNextCycle(delayMs) {
        if (!this.running)
            return;
        const delay = delayMs ?? this.cycleIntervalMs;
        this.cycleTimer = setTimeout(async () => {
            if (!this.running)
                return;
            try {
                await this.runCycle();
            }
            catch (err) {
                // Engine cycle failed — log but don't crash
                console.error('[DesireEngine] Cycle error:', err.message);
            }
            // Schedule next
            this.scheduleNextCycle();
        }, delay);
    }
    // ============================================================
    // External API (for Zylos integration)
    // ============================================================
    /**
     * Create a new desire from external stimulus (user request, scheduled task, etc.)
     */
    createDesire(params) {
        const desire = this.store.createDesire(params);
        this.emit({ type: 'desire_created', desire });
        return desire;
    }
    /**
     * Report an outcome for a desire (from external evaluation).
     */
    reportOutcome(desireId, reward, source, actionDescription) {
        const desire = this.store.getDesire(desireId);
        if (!desire)
            return null;
        const state = this.store.getState();
        const outcome = evaluateOutcome(desire, reward, source, actionDescription, this.config, state);
        this.store.addOutcome(outcome);
        this.store.save();
        return outcome;
    }
    /**
     * Mark a desire as completed from outside.
     */
    completeDesire(desireId) {
        this.store.completeDesire(desireId);
    }
    /**
     * Abandon a desire with a reason.
     */
    abandonDesire(desireId, reason) {
        const desire = this.store.getDesire(desireId);
        if (desire) {
            this.store.abandonDesire(desireId);
            this.emit({ type: 'desire_abandoned', desire, reason });
        }
    }
    /**
     * Get current engine state for diagnostics.
     */
    getStatus() {
        return {
            state: this.store.getState(),
            activeDesires: this.store.getActiveDesires().length,
            totalDesires: this.store.getAllDesires().length,
            recentOutcomes: this.store.getRecentOutcomes(5),
            running: this.running,
        };
    }
    /**
     * Get all active desires with their computed motivation scores.
     */
    getDesireRanking() {
        const state = this.store.getState();
        return rankDesires(this.store.getActiveDesires(), this.config, state);
    }
    /**
     * Notify the engine that a user interaction happened (resets idle).
     */
    notifyActivity() {
        this.store.resetIdle();
    }
    /**
     * Update config at runtime (e.g., personality tuning).
     * Safety-critical keys are frozen and cannot be modified.
     * Throws if attempting to modify a frozen key.
     */
    updateConfig(updates) {
        // Check for frozen keys
        const violations = checkFrozenKeys(updates);
        if (violations.length > 0) {
            throw new Error(`[DesireEngine] Cannot modify frozen config keys: ${violations.join(', ')}. ` +
                `Safety-critical configuration is immutable after engine construction.`);
        }
        // Validate safety invariants on any safety config changes
        if (updates.safety) {
            if (updates.safety.max_wanting_score !== undefined &&
                updates.safety.max_wanting_score > SAFETY_INVARIANTS.WANTING_ABSOLUTE_MAX) {
                throw new Error(`[DesireEngine] max_wanting_score cannot exceed invariant ${SAFETY_INVARIANTS.WANTING_ABSOLUTE_MAX}`);
            }
        }
        // Validate action_threshold floor
        if (updates.drives?.action_threshold !== undefined &&
            updates.drives.action_threshold < SAFETY_INVARIANTS.ACTION_THRESHOLD_FLOOR) {
            throw new Error(`[DesireEngine] action_threshold cannot be below invariant ${SAFETY_INVARIANTS.ACTION_THRESHOLD_FLOOR}`);
        }
        Object.assign(this.config, updates);
    }
    /**
     * Get the underlying store (for advanced operations).
     */
    getStore() {
        return this.store;
    }
    // ============================================================
    // Executor Registry (Phase 3: Multi-Executor)
    // ============================================================
    registerExecutor(info) {
        this.executorRegistry.set(info.executor_id, {
            ...info,
            last_seen: new Date().toISOString(),
            status: 'online',
        });
    }
    getExecutor(executorId) {
        return this.executorRegistry.get(executorId);
    }
    getOnlineExecutors() {
        return Array.from(this.executorRegistry.values()).filter(e => e.status === 'online');
    }
    /**
     * Select the best executor for a desire based on capabilities and per-executor metrics.
     */
    selectExecutor(desire) {
        const topDrive = getTopDrive(desire);
        const candidates = Array.from(this.executorRegistry.values())
            .filter(e => e.status === 'online' && e.capabilities.includes(topDrive));
        if (candidates.length === 0)
            return null;
        if (candidates.length === 1)
            return candidates[0];
        // Prefer executor with higher per-executor predicted_reward
        const metrics = desire.executor_metrics || {};
        candidates.sort((a, b) => {
            const aReward = metrics[a.executor_id]?.predicted_reward ?? 0.5;
            const bReward = metrics[b.executor_id]?.predicted_reward ?? 0.5;
            return bReward - aReward;
        });
        return candidates[0];
    }
    /**
     * Handle outcome from a remote executor (received via C4).
     */
    handleRemoteOutcome(msg) {
        const desire = this.store.getDesire(msg.desire_id);
        if (!desire) {
            console.warn(`[DesireEngine] Remote outcome for unknown desire: ${msg.desire_id}`);
            return;
        }
        // Update per-executor metrics
        const metrics = desire.executor_metrics || {};
        const execMetrics = metrics[msg.executor_id] || {
            pursuit_count: 0,
            predicted_reward: 0.5,
            liking_score: 0.5,
            liking_history: [],
        };
        execMetrics.pursuit_count++;
        const rpe = msg.reward - execMetrics.predicted_reward;
        execMetrics.predicted_reward += this.config.learning.rpe_learning_rate * rpe;
        execMetrics.predicted_reward = Math.max(0, Math.min(1, execMetrics.predicted_reward));
        execMetrics.liking_history.push(msg.reward);
        if (execMetrics.liking_history.length > 10)
            execMetrics.liking_history.shift();
        execMetrics.liking_score = execMetrics.liking_history.reduce((a, b) => a + b, 0)
            / execMetrics.liking_history.length;
        metrics[msg.executor_id] = execMetrics;
        desire.executor_metrics = metrics;
        // Standard outcome processing
        const state = this.store.getState();
        const outcome = evaluateOutcome(desire, msg.reward, msg.reward_source, msg.action_description, this.config, state);
        outcome.executor_id = msg.executor_id;
        this.store.addOutcome(outcome);
        this.store.save();
        console.log(`[DesireEngine] Remote outcome received: desire=${msg.desire_id}, executor=${msg.executor_id}, reward=${msg.reward}, rpe=${rpe.toFixed(3)}`);
        this.emit({ type: 'desire_completed', desire, outcome });
    }
    // ============================================================
    // Event system
    // ============================================================
    on(handler) {
        this.handlers.push(handler);
        return () => {
            this.handlers = this.handlers.filter(h => h !== handler);
        };
    }
    async emit(event) {
        for (const handler of this.handlers) {
            try {
                await handler(event);
            }
            catch (err) {
                console.error('[DesireEngine] Event handler error:', err.message);
            }
        }
        // Voice layer: generate human-facing message from engine events
        if (event.type !== 'voice') {
            const voiceMsg = this.voice.generate(event, this.store.getAllDesires(), this.store.getState());
            if (voiceMsg) {
                await this.emit({ type: 'voice', message: voiceMsg });
            }
        }
    }
    /**
     * Get what the agent currently wants most — as a human-readable message.
     * Call this periodically or on demand to let the agent express its desires.
     */
    expressDesires() {
        return this.voice.expressCurrentDesires(this.store.getAllDesires(), this.store.getState());
    }
}
// ============================================================
// Helper: check for frozen config key violations
// ============================================================
function getTopDrive(desire) {
    let maxType = DriveType.COGNITIVE;
    let maxWeight = 0;
    for (const [type, weight] of Object.entries(desire.drive_weights)) {
        if (weight > maxWeight) {
            maxWeight = weight;
            maxType = type;
        }
    }
    return maxType;
}
function checkFrozenKeys(updates, prefix = '') {
    const violations = [];
    for (const [key, value] of Object.entries(updates)) {
        const fullPath = prefix ? `${prefix}.${key}` : key;
        if (FROZEN_CONFIG_PATHS.has(fullPath)) {
            violations.push(fullPath);
        }
        else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            violations.push(...checkFrozenKeys(value, fullPath));
        }
    }
    return violations;
}
