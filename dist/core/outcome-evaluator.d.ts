/**
 * Outcome Evaluator
 * Computes RPE (Reward Prediction Error) and updates desire parameters.
 * Implements dynamic learning rate (ACh analog).
 */
import { Desire, OutcomeRecord, RewardSource, DesireEngineConfig, EngineState } from '../types.js';
/**
 * Evaluate the outcome of pursuing a desire.
 * Returns an OutcomeRecord with RPE and updates the desire in-place.
 */
export declare function evaluateOutcome(desire: Desire, actualReward: number, rewardSource: RewardSource, actionTaken: string, config: DesireEngineConfig, state: EngineState): OutcomeRecord;
