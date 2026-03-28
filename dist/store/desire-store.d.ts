/**
 * Desire Store
 * Persists desires, outcome records, and engine state to JSON files.
 * MVP implementation — can be upgraded to SQLite later.
 */
import { Desire, OutcomeRecord, EngineState, DriveType, RiskLevel } from '../types.js';
export declare class DesireStore {
    private dataDir;
    private desires;
    private outcomes;
    private state;
    constructor(dataDir: string);
    createDesire(params: {
        goal: string;
        description?: string;
        drive_weights?: Partial<Record<DriveType, number>>;
        source?: 'internal' | 'external';
        risk_level?: RiskLevel;
        deadline?: string;
        tags?: string[];
        urgency?: number;
        expectancy?: number;
        predicted_reward?: number;
        cost?: number;
    }): Desire;
    getDesire(id: string): Desire | undefined;
    getActiveDesires(): Desire[];
    getAllDesires(): Desire[];
    updateDesire(id: string, updates: Partial<Desire>): void;
    completeDesire(id: string): void;
    abandonDesire(id: string): void;
    addOutcome(record: OutcomeRecord): void;
    getOutcomesForDesire(desireId: string): OutcomeRecord[];
    getRecentOutcomes(count?: number): OutcomeRecord[];
    getState(): EngineState;
    updateState(updates: Partial<EngineState>): void;
    updateIdleTime(): void;
    resetIdle(): void;
    private saveTimer;
    private savePending;
    save(): void;
    /** Force immediate write (call on shutdown). */
    flush(): void;
    private flushToDisk;
    private loadDesires;
    private loadOutcomes;
    private loadState;
}
