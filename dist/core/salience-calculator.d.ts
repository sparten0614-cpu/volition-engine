/**
 * Salience Calculator
 * Computes motivation scores for desires using weighted sum (not multiplication).
 * Fixes: multiplication zero-out problem, score compression problem.
 */
import { Desire, DesireEngineConfig, EngineState } from '../types.js';
/**
 * Compute the motivation score for a single desire.
 * Uses weighted sum instead of multiplication to avoid zero-out.
 * Applies softmax-style selection across all desires.
 */
export declare function computeMotivationScore(desire: Desire, config: DesireEngineConfig, state: EngineState): number;
/**
 * Rank desires using softmax-inspired temperature scaling.
 * This amplifies differences between similar scores (fixes score compression).
 */
export declare function rankDesires(desires: Desire[], config: DesireEngineConfig, state: EngineState, temperature?: number): Array<{
    desire: Desire;
    score: number;
    probability: number;
}>;
