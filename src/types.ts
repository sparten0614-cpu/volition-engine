/**
 * Desire System — Core Type Definitions
 * AI Agent 欲望系统
 */

// ============================================================
// Drive Types
// ============================================================

export enum DriveType {
  HOMEOSTATIC = 'homeostatic',       // Resource maintenance (disk, memory, API quota)
  COGNITIVE = 'cognitive',           // Curiosity, exploration, mastery
  SOCIAL = 'social',                 // Recognition, sharing, collaboration
  SELF_ACTUALIZATION = 'self_act',   // Self-improvement, creativity
}

export type DriveWeights = Record<DriveType, number>;

// ============================================================
// Risk Levels
// ============================================================

export enum RiskLevel {
  LOW = 'low',         // Auto-execute (research, self-optimization, internal analysis)
  MEDIUM = 'medium',   // Execute and report (proactive sharing, scheduled tasks)
  HIGH = 'high',       // Require human approval (external comms, code changes, spending)
}

// ============================================================
// Desire
// ============================================================

export interface Desire {
  id: string;
  goal: string;
  description?: string;

  // Drive composition (multi-dimensional, not single enum)
  drive_weights: DriveWeights;

  // Wanting system (Dopamine analog — pursuit motivation)
  wanting_score: number;           // [0, 1]
  predicted_reward: number;        // [0, 1] expected value
  novelty_bonus: number;           // [0, 1] boost for novel goals (floor: 0.1)

  // Liking system (Endorphin analog — outcome satisfaction)
  liking_score: number;            // [0, 1] historical satisfaction
  liking_history: number[];        // Rolling window of past satisfaction

  // Evaluation (PFC/ACC analog)
  expectancy: number;              // [0, 1] P(success)
  cost: number;                    // [0, 1] effort/resource cost
  urgency: number;                 // [0, 1] time pressure
  deadline?: string;               // ISO date string

  // Execution
  risk_level: RiskLevel;
  subgoals?: Subgoal[];
  habit_strength: number;          // [0, 1] how automatized

  // Metadata
  source: 'internal' | 'external';
  created_at: string;
  last_pursued?: string;
  pursuit_count: number;
  status: 'active' | 'completed' | 'abandoned' | 'expired';

  // Tags for matching & GC
  tags?: string[];

  // Multi-executor metrics (Phase 3)
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

// ============================================================
// Drive Signal
// ============================================================

export interface DriveSignal {
  type: DriveType;
  source: string;          // What triggered this signal
  intensity: number;       // [0, 1]
  description: string;     // Human-readable explanation
  stimulus?: any;          // The triggering data
  timestamp: string;
}

// ============================================================
// Outcome Record (for RPE learning)
// ============================================================

export interface OutcomeRecord {
  desire_id: string;
  predicted_reward: number;
  actual_reward: number;
  rpe: number;              // actual - predicted
  reward_source: RewardSource;
  action_taken: string;
  timestamp: string;
  executor_id?: string;     // Which executor produced this outcome
  context?: Record<string, any>;
}

// ============================================================
// Executor Types (Phase 3: Multi-Executor)
// ============================================================

export interface ExecutorInfo {
  executor_id: string;           // e.g., 'sz', 'yangyang'
  display_name: string;          // Human-readable name
  c4_endpoint: string;           // C4 endpoint for dispatch (e.g., 'org:sparten|阳阳')
  capabilities: DriveType[];     // What drive types this executor handles
  status: 'online' | 'offline';
  last_seen: string;             // ISO timestamp
  registered_at: string;
}

export interface ExecutorMetrics {
  pursuit_count: number;
  predicted_reward: number;      // Per-executor predicted reward
  liking_score: number;
  liking_history: number[];
}

// ============================================================
// C4 Message Types (Desire Task Dispatch)
// ============================================================

export interface DesireTaskMessage {
  type: 'desire-task';
  desire_id: string;
  goal: string;
  description?: string;
  drive_type: DriveType;
  risk_level: RiskLevel;
  timeout_ms: number;           // Default: 600000 (10 min)
  assigned_at: string;
}

export interface DesireOutcomeMessage {
  type: 'desire-outcome';
  desire_id: string;
  executor_id: string;
  success: boolean;
  reward: number;               // [0, 1] — executor self-eval
  reward_source: RewardSource;
  action_description: string;
  findings_summary?: string;    // Content summary for memory chaining
}

export enum RewardSource {
  HARD_METRIC = 'hard_metric',       // Measurable KPI (error rate, user reaction)
  USER_FEEDBACK = 'user_feedback',   // Explicit user rating
  SELF_EVAL = 'self_eval',           // LLM self-evaluation (lowest confidence)
  COMPLETION = 'completion',         // Binary: did the task complete?
}

// ============================================================
// Engine State
// ============================================================

export interface EngineState {
  // Tonic baseline (overall arousal/motivation level)
  baseline_motivation: number;     // [0, 1] influenced by recent success rate & system health

  // Idle tracking
  idle_since: string;              // ISO timestamp
  idle_duration_seconds: number;

  // Mode
  mode: EngineMode;

  // Stats
  recent_success_rate: number;     // Rolling window
  total_cycles: number;
  last_cycle_at: string;

  // Safety tracking (#6 anti-depression escalation)
  depression_floor_count: number;  // How many times baseline hit floor — escalate after N
}

export enum EngineMode {
  ACTIVE = 'active',               // Executing a desire
  REFLECTIVE = 'reflective',       // DMN-inspired: reviewing strategy, consolidating memory
  EXPLORING = 'exploring',         // Scanning for new opportunities
  WAITING = 'waiting',             // Idle, anxiety building
}

// ============================================================
// Configuration
// ============================================================

export interface DesireEngineConfig {
  personality: string;

  drives: {
    idle_anxiety_rate: number;          // How quickly idle discomfort builds [0, 1]
    action_threshold: number;           // Min motivation_score to act [0, 1]
    curiosity_weight: number;           // [0, 1]
    mastery_weight: number;             // [0, 1]
    social_weight: number;              // [0, 1]
    reflection_interval_seconds: number; // How often to enter reflective mode
  };

  learning: {
    rpe_learning_rate: number;          // How fast predictions update
    reinforcement_rate: number;         // How fast wanting changes
    habituation_rate: number;           // How fast behaviors become automatic
    min_learning_rate: number;          // Floor for dynamic learning rate
    max_learning_rate: number;          // Ceiling for dynamic learning rate
  };

  safety: {
    max_wanting_score: number;          // Ceiling to prevent addiction [0, 1]
    min_activity_interval_seconds: number; // Force action after N seconds idle
    reeval_interval_seconds: number;    // Re-evaluate stale P(success)
    diversity_min_types: number;        // Min active drive types
    max_active_desires: number;         // Desire GC threshold
    desire_ttl_seconds: number;         // Auto-expire unfulfilled desires
  };

  risk_gate: {
    low_risk_autonomous: boolean;
    medium_risk_notify: boolean;
    high_risk_approval: boolean;
  };

  temporal: {
    discount_rate: number;              // Future value decay per day [0, 1]
    urgency_boost_near_deadline: number; // Multiplier when deadline is close
  };
}
