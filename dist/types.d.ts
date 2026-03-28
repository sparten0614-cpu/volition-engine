/**
 * Desire System — Core Type Definitions
 * AI Agent 欲望系统
 */
export declare enum DriveType {
    HOMEOSTATIC = "homeostatic",// Resource maintenance (disk, memory, API quota)
    COGNITIVE = "cognitive",// Curiosity, exploration, mastery
    SOCIAL = "social",// Recognition, sharing, collaboration
    SELF_ACTUALIZATION = "self_act"
}
export type DriveWeights = Record<DriveType, number>;
export declare enum RiskLevel {
    LOW = "low",// Auto-execute (research, self-optimization, internal analysis)
    MEDIUM = "medium",// Execute and report (proactive sharing, scheduled tasks)
    HIGH = "high"
}
export interface Desire {
    id: string;
    goal: string;
    description?: string;
    drive_weights: DriveWeights;
    wanting_score: number;
    predicted_reward: number;
    novelty_bonus: number;
    liking_score: number;
    liking_history: number[];
    expectancy: number;
    cost: number;
    urgency: number;
    deadline?: string;
    risk_level: RiskLevel;
    subgoals?: Subgoal[];
    habit_strength: number;
    source: 'internal' | 'external';
    created_at: string;
    last_pursued?: string;
    pursuit_count: number;
    status: 'active' | 'completed' | 'abandoned' | 'expired';
    tags?: string[];
    executor_metrics?: Record<string, ExecutorMetrics>;
    preferred_executor?: string;
}
export interface Subgoal {
    id: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    predicted_reward: number;
    actual_reward?: number;
}
export interface DriveSignal {
    type: DriveType;
    source: string;
    intensity: number;
    description: string;
    stimulus?: any;
    timestamp: string;
}
export interface OutcomeRecord {
    desire_id: string;
    predicted_reward: number;
    actual_reward: number;
    rpe: number;
    reward_source: RewardSource;
    action_taken: string;
    timestamp: string;
    executor_id?: string;
    context?: Record<string, any>;
}
export interface ExecutorInfo {
    executor_id: string;
    display_name: string;
    c4_endpoint: string;
    capabilities: DriveType[];
    status: 'online' | 'offline';
    last_seen: string;
    registered_at: string;
}
export interface ExecutorMetrics {
    pursuit_count: number;
    predicted_reward: number;
    liking_score: number;
    liking_history: number[];
}
export interface DesireTaskMessage {
    type: 'desire-task';
    desire_id: string;
    goal: string;
    description?: string;
    drive_type: DriveType;
    risk_level: RiskLevel;
    timeout_ms: number;
    assigned_at: string;
}
export interface DesireOutcomeMessage {
    type: 'desire-outcome';
    desire_id: string;
    executor_id: string;
    success: boolean;
    reward: number;
    reward_source: RewardSource;
    action_description: string;
    findings_summary?: string;
}
export declare enum RewardSource {
    HARD_METRIC = "hard_metric",// Measurable KPI (error rate, user reaction)
    USER_FEEDBACK = "user_feedback",// Explicit user rating
    SELF_EVAL = "self_eval",// LLM self-evaluation (lowest confidence)
    COMPLETION = "completion"
}
export interface EngineState {
    baseline_motivation: number;
    idle_since: string;
    idle_duration_seconds: number;
    mode: EngineMode;
    recent_success_rate: number;
    total_cycles: number;
    last_cycle_at: string;
    depression_floor_count: number;
}
export declare enum EngineMode {
    ACTIVE = "active",// Executing a desire
    REFLECTIVE = "reflective",// DMN-inspired: reviewing strategy, consolidating memory
    EXPLORING = "exploring",// Scanning for new opportunities
    WAITING = "waiting"
}
export interface DesireEngineConfig {
    personality: string;
    drives: {
        idle_anxiety_rate: number;
        action_threshold: number;
        curiosity_weight: number;
        mastery_weight: number;
        social_weight: number;
        reflection_interval_seconds: number;
    };
    learning: {
        rpe_learning_rate: number;
        reinforcement_rate: number;
        habituation_rate: number;
        min_learning_rate: number;
        max_learning_rate: number;
    };
    safety: {
        max_wanting_score: number;
        min_activity_interval_seconds: number;
        reeval_interval_seconds: number;
        diversity_min_types: number;
        max_active_desires: number;
        desire_ttl_seconds: number;
    };
    risk_gate: {
        low_risk_autonomous: boolean;
        medium_risk_notify: boolean;
        high_risk_approval: boolean;
    };
    temporal: {
        discount_rate: number;
        urgency_boost_near_deadline: number;
    };
}
