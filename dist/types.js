/**
 * Desire System — Core Type Definitions
 * AI Agent 欲望系统
 */
// ============================================================
// Drive Types
// ============================================================
export var DriveType;
(function (DriveType) {
    DriveType["HOMEOSTATIC"] = "homeostatic";
    DriveType["COGNITIVE"] = "cognitive";
    DriveType["SOCIAL"] = "social";
    DriveType["SELF_ACTUALIZATION"] = "self_act";
})(DriveType || (DriveType = {}));
// ============================================================
// Risk Levels
// ============================================================
export var RiskLevel;
(function (RiskLevel) {
    RiskLevel["LOW"] = "low";
    RiskLevel["MEDIUM"] = "medium";
    RiskLevel["HIGH"] = "high";
})(RiskLevel || (RiskLevel = {}));
export var RewardSource;
(function (RewardSource) {
    RewardSource["HARD_METRIC"] = "hard_metric";
    RewardSource["USER_FEEDBACK"] = "user_feedback";
    RewardSource["SELF_EVAL"] = "self_eval";
    RewardSource["COMPLETION"] = "completion";
})(RewardSource || (RewardSource = {}));
export var EngineMode;
(function (EngineMode) {
    EngineMode["ACTIVE"] = "active";
    EngineMode["REFLECTIVE"] = "reflective";
    EngineMode["EXPLORING"] = "exploring";
    EngineMode["WAITING"] = "waiting";
})(EngineMode || (EngineMode = {}));
