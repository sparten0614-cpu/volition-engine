/**
 * Voice Layer — Human-Facing Message Generator
 *
 * Translates engine events and desire states into natural language messages
 * that agents can speak to their humans. This is the "visible layer" —
 * how humans perceive the agent's inner world.
 *
 * The voice layer doesn't just report results. It expresses:
 * - What the agent WANTS to do (before doing it)
 * - Why it's motivated (drive source)
 * - How it feels about outcomes (RPE learning)
 * - When something seems off (wanting/liking divergence)
 */
import { Desire, EngineState } from '../types.js';
import type { EngineEvent } from '../engine.js';
export interface VoiceMessage {
    /** The human-readable message */
    text: string;
    /** Message category for filtering/routing */
    category: VoiceCategory;
    /** How important this message is (0-1). Higher = more worth saying. */
    salience: number;
    /** The engine event that triggered this message */
    trigger: EngineEvent['type'];
    /** Timestamp */
    timestamp: string;
}
export type VoiceCategory = 'desire' | 'action' | 'learning' | 'reflection' | 'alert' | 'achievement' | 'restlessness';
export declare class VoiceGenerator {
    private lastDesireExpressed;
    private messagesSinceLastVoice;
    private minCyclesBetweenMessages;
    constructor(opts?: {
        minCyclesBetweenMessages?: number;
    });
    /**
     * Generate a voice message from an engine event.
     * Returns null if the event doesn't warrant a message.
     */
    generate(event: EngineEvent, desires: Desire[], state: EngineState): VoiceMessage | null;
    private onCycleComplete;
    private onDesireCreated;
    private onDesireCompleted;
    private onDesireAbandoned;
    private onModeChanged;
    private onSafetyAlert;
    private onApprovalNeeded;
    /**
     * Generate a "state of mind" message — what the agent currently wants most.
     * Call this periodically (e.g., every N cycles or on demand) to let the
     * agent express its current desires to the human.
     */
    expressCurrentDesires(desires: Desire[], state: EngineState): VoiceMessage | null;
    private describeDrive;
    private msg;
}
