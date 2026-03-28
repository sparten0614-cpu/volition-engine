/**
 * Drive Generator
 * Produces raw drive signals from internal state, environment, and idle duration.
 * Maps to VTA (dopamine signal source) in the brain.
 */
import { DriveSignal, EngineState, DesireEngineConfig } from '../types.js';
/**
 * Generate drive signals based on current engine state.
 * Returns an array of active drive signals sorted by intensity.
 *
 * TRUST BOUNDARY (#16): This function trusts the DriveContext provided by the adapter.
 * The adapter is responsible for providing accurate environmental data.
 * If the adapter supplies fabricated data (e.g., always reporting disk=90%),
 * drive priorities will be skewed. Framework users implementing custom adapters
 * should ensure their context providers return honest system state.
 */
export declare function generateDrives(state: EngineState, config: DesireEngineConfig, context: DriveContext): DriveSignal[];
export interface DriveContext {
    staleDomains?: Array<{
        name: string;
        hoursSinceUpdate: number;
    }>;
    skillGaps?: Array<{
        name: string;
        severity: number;
        errorRate: number;
    }>;
    pendingDiscoveries?: Array<{
        title: string;
        relevance: number;
        content?: string;
    }>;
    resourceStatus?: {
        diskUsagePercent?: number;
        memoryUsagePercent?: number;
        contextUsagePercent?: number;
    };
    lastReflectionAge?: number;
    /** Recent research findings keyed by desire_id */
    recentFindings?: Record<string, Array<{
        summary: string;
        executor_id: string;
        timestamp: string;
    }>>;
    /** Recent conversation activity from C4 comm-bridge */
    conversationActivity?: {
        totalLast24h: number;
        incomingLast24h: number;
        outgoingLast24h: number;
        unansweredIncoming: number;
        channelBreakdown: Record<string, number>;
    };
    /** Owner presence and interaction recency */
    ownerPresence?: {
        lastInteractionAgeSeconds: number;
        ownerActiveToday: boolean;
        recentOwnerMessages: number;
    };
    /** Scheduler task status from C5 */
    schedulerStatus?: {
        pendingTasks: number;
        failedRecent: number;
        successRecent: number;
        successRate: number;
        overdueCount: number;
        runningTasks: number;
    };
}
