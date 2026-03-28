/**
 * Executive Planner
 * Selects the top desire to pursue, applies risk gate, manages mode switching.
 * Maps to PFC (planning) + ACC (cost-benefit) + LC-NE (explore-exploit).
 */
import { Desire, DesireEngineConfig, EngineState, EngineMode, DriveSignal } from '../types.js';
export interface PlanDecision {
    action: 'pursue' | 'reflect' | 'explore' | 'wait' | 'blocked';
    desire?: Desire;
    score?: number;
    reason: string;
    mode: EngineMode;
    requiresApproval: boolean;
}
/**
 * Decide what to do next based on active desires and engine state.
 * Implements explore-exploit switching (LC-NE adaptive gain).
 */
export declare function planNextAction(desires: Desire[], signals: DriveSignal[], config: DesireEngineConfig, state: EngineState): PlanDecision;
