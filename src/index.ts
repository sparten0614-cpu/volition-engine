/**
 * Desire Engine — Public API
 */

// Core types
export * from './types.js';

// Engine
export { DesireEngine } from './engine.js';
export type { EngineEvent, EventHandler, ContextProvider, ActionExecutor, ActionResult } from './engine.js';

// Modules
export { generateDrives } from './core/drive-generator.js';
export type { DriveContext } from './core/drive-generator.js';
export { computeMotivationScore, rankDesires } from './core/salience-calculator.js';
export { planNextAction } from './core/executive-planner.js';
export type { PlanDecision } from './core/executive-planner.js';
export { evaluateOutcome } from './core/outcome-evaluator.js';
export { runSafetyChecks, SAFETY_INVARIANTS } from './core/safety.js';
export type { SafetyReport, SafetyIssue } from './core/safety.js';
export { DesireStore } from './store/desire-store.js';

// Voice layer
export { VoiceGenerator } from './core/voice.js';
export type { VoiceMessage, VoiceCategory } from './core/voice.js';

// Zylos adapter
export { createZylosDesireEngine, loadConfig, dispatchToRemoteExecutor, storeFindingsSummary, getRecentFindings } from './zylos-adapter.js';
export type { FindingsEntry } from './zylos-adapter.js';
