/**
 * Outcome Evaluator
 * Computes RPE (Reward Prediction Error) and updates desire parameters.
 * Implements dynamic learning rate (ACh analog).
 */
/**
 * Evaluate the outcome of pursuing a desire.
 * Returns an OutcomeRecord with RPE and updates the desire in-place.
 */
export function evaluateOutcome(desire, actualReward, rewardSource, actionTaken, config, state) {
    // Clamp actual reward to [0, 1]
    actualReward = Math.max(0, Math.min(1, actualReward));
    // Compute RPE
    const rpe = actualReward - desire.predicted_reward;
    // Dynamic learning rate (ACh analog)
    // Higher when environment is uncertain (high RPE variance), lower when stable
    const learningRate = computeDynamicLearningRate(Math.abs(rpe), config.learning.rpe_learning_rate, config.learning.min_learning_rate, config.learning.max_learning_rate);
    // Update predicted_reward (exponential moving average)
    desire.predicted_reward = clamp(desire.predicted_reward + learningRate * rpe, 0, 1);
    // Update wanting_score based on RPE
    desire.wanting_score = clamp(desire.wanting_score + config.learning.reinforcement_rate * rpe, 0, config.safety.max_wanting_score // Ceiling prevents addiction
    );
    // Update liking_score (rolling average of actual satisfaction)
    desire.liking_history.push(actualReward);
    if (desire.liking_history.length > 10) {
        desire.liking_history.shift(); // Keep last 10
    }
    desire.liking_score = desire.liking_history.reduce((a, b) => a + b, 0) / desire.liking_history.length;
    // #11: Novelty decay — older desires lose novelty bonus over time
    const ageHours = (Date.now() - new Date(desire.created_at).getTime()) / (1000 * 60 * 60);
    const decayRate = 0.02; // ~50% decay after 35 hours
    desire.novelty_bonus = clamp(desire.novelty_bonus * Math.exp(-decayRate * ageHours), 0.1, 1 // Floor 0.1 to avoid zero-out in salience calculation
    );
    // Detect wanting/liking divergence
    const divergence = detectWantingLikingDivergence(desire);
    // Update habit strength
    if (Math.abs(rpe) < 0.1) {
        // Low RPE (outcome as expected) → strengthen habit
        desire.habit_strength = clamp(desire.habit_strength + config.learning.habituation_rate, 0, 1);
    }
    else if (rpe < -0.3) {
        // Large negative RPE → break habit (re-engage goal-directed mode)
        desire.habit_strength = clamp(desire.habit_strength - config.learning.habituation_rate * 3, 0, 1);
    }
    // Update pursuit count
    desire.pursuit_count += 1;
    desire.last_pursued = new Date().toISOString();
    // Update expectancy based on success/failure
    if (actualReward > 0.5) {
        desire.expectancy = clamp(desire.expectancy + learningRate * 0.1, 0, 1);
    }
    else {
        desire.expectancy = clamp(desire.expectancy - learningRate * 0.1, 0.05, 1); // Floor 0.05 prevents learned helplessness
        // #10: If expectancy at floor AND too many pursuits, mark for abandonment.
        // Safety.ts will enforce this, but we flag it here for faster detection.
        if (desire.expectancy <= 0.06 && desire.pursuit_count >= 10) {
            desire.status = 'abandoned';
        }
    }
    // Update baseline motivation (tonic dopamine)
    state.baseline_motivation = clamp(state.baseline_motivation + rpe * 0.05, 0.2, 1.0 // Floor prevents depression-like state
    );
    // #12: Spontaneous recovery — if baseline is near floor, slowly recover
    // Mimics biological SSP (spontaneous recovery from conditioned suppression)
    if (state.baseline_motivation < 0.35) {
        state.baseline_motivation = clamp(state.baseline_motivation + 0.01, // Slow auto-recovery per cycle
        0.2, 1.0);
    }
    state.recent_success_rate = clamp(state.recent_success_rate * 0.9 + (actualReward > 0.5 ? 0.1 : 0), 0, 1);
    // Build outcome record
    const record = {
        desire_id: desire.id,
        predicted_reward: desire.predicted_reward,
        actual_reward: actualReward,
        rpe,
        reward_source: rewardSource,
        action_taken: actionTaken,
        timestamp: new Date().toISOString(),
        context: divergence ? { wanting_liking_divergence: divergence } : undefined,
    };
    return record;
}
/**
 * Detect wanting/liking divergence — informational only.
 * Enforcement (capping, abandoning) happens in safety.ts using SAFETY_INVARIANTS.
 * This function only records the divergence value for diagnostics.
 */
function detectWantingLikingDivergence(desire) {
    const gap = desire.wanting_score - desire.liking_score;
    // Only log significant divergence for diagnostics — no threshold-based action here.
    // Safety enforcement uses SAFETY_INVARIANTS.ADDICTION_DIVERGENCE_THRESHOLD (0.3).
    if (Math.abs(gap) > 0.2 && desire.pursuit_count > 3) {
        const direction = gap > 0 ? 'wanting > liking' : 'liking > wanting';
        return `Divergence detected: ${direction} (gap: ${gap.toFixed(2)}) for "${desire.goal}" after ${desire.pursuit_count} pursuits`;
    }
    return null;
}
/**
 * Dynamic learning rate based on prediction error magnitude.
 * Large errors → faster learning (new/uncertain environment)
 * Small errors → slower learning (stable environment)
 */
function computeDynamicLearningRate(absRpe, baseLR, minLR, maxLR) {
    // Scale learning rate with RPE magnitude
    const dynamicLR = baseLR * (1 + absRpe * 2);
    return clamp(dynamicLR, minLR, maxLR);
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
