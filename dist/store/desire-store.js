/**
 * Desire Store
 * Persists desires, outcome records, and engine state to JSON files.
 * MVP implementation — can be upgraded to SQLite later.
 */
import * as fs from 'fs';
import * as path from 'path';
import { EngineMode, DriveType, RiskLevel } from '../types.js';
export class DesireStore {
    dataDir;
    desires = new Map();
    outcomes = [];
    state;
    constructor(dataDir) {
        this.dataDir = dataDir;
        fs.mkdirSync(dataDir, { recursive: true });
        // Load or initialize
        this.desires = this.loadDesires();
        this.outcomes = this.loadOutcomes();
        this.state = this.loadState();
    }
    // ============================================================
    // Desire CRUD
    // ============================================================
    createDesire(params) {
        // Validate and normalize drive weights (#8)
        const rawWeights = {
            [DriveType.HOMEOSTATIC]: 0,
            [DriveType.COGNITIVE]: 0,
            [DriveType.SOCIAL]: 0,
            [DriveType.SELF_ACTUALIZATION]: 0,
            ...params.drive_weights,
        };
        // Clamp negatives to 0
        for (const key of Object.keys(rawWeights)) {
            if (rawWeights[key] < 0)
                rawWeights[key] = 0;
        }
        // If all weights are 0, default to cognitive=0.5
        const totalWeight = Object.values(rawWeights).reduce((a, b) => a + b, 0);
        if (totalWeight === 0) {
            rawWeights[DriveType.COGNITIVE] = 0.5;
        }
        const desire = {
            id: generateId(),
            goal: params.goal,
            description: params.description,
            drive_weights: rawWeights,
            wanting_score: 0.5, // Start moderate
            predicted_reward: params.predicted_reward ?? 0.5,
            novelty_bonus: 0.8, // New desires start novel
            liking_score: 0.5,
            liking_history: [],
            expectancy: params.expectancy ?? 0.5,
            cost: params.cost ?? 0.3,
            urgency: params.urgency ?? 0.3,
            deadline: params.deadline,
            risk_level: params.risk_level ?? RiskLevel.LOW,
            habit_strength: 0,
            source: params.source ?? 'internal',
            created_at: new Date().toISOString(),
            pursuit_count: 0,
            status: 'active',
            tags: params.tags,
        };
        this.desires.set(desire.id, desire);
        this.save();
        return desire;
    }
    getDesire(id) {
        return this.desires.get(id);
    }
    getActiveDesires() {
        return Array.from(this.desires.values()).filter(d => d.status === 'active');
    }
    getAllDesires() {
        return Array.from(this.desires.values());
    }
    updateDesire(id, updates) {
        const desire = this.desires.get(id);
        if (desire) {
            Object.assign(desire, updates);
            this.save();
        }
    }
    completeDesire(id) {
        this.updateDesire(id, { status: 'completed' });
    }
    abandonDesire(id) {
        this.updateDesire(id, { status: 'abandoned' });
    }
    // ============================================================
    // Outcome Records
    // ============================================================
    addOutcome(record) {
        this.outcomes.push(record);
        // Keep last 500 records
        if (this.outcomes.length > 500) {
            this.outcomes = this.outcomes.slice(-500);
        }
        this.save();
    }
    getOutcomesForDesire(desireId) {
        return this.outcomes.filter(o => o.desire_id === desireId);
    }
    getRecentOutcomes(count = 20) {
        return this.outcomes.slice(-count);
    }
    // ============================================================
    // Engine State
    // ============================================================
    getState() {
        return this.state;
    }
    updateState(updates) {
        Object.assign(this.state, updates);
        this.save();
    }
    updateIdleTime() {
        const now = Date.now();
        const idleSince = new Date(this.state.idle_since).getTime();
        this.state.idle_duration_seconds = (now - idleSince) / 1000;
    }
    resetIdle() {
        this.state.idle_since = new Date().toISOString();
        this.state.idle_duration_seconds = 0;
    }
    // ============================================================
    // Persistence (#17: debounced write to avoid IO bottleneck at high frequency)
    // ============================================================
    saveTimer = null;
    savePending = false;
    save() {
        // Debounce: batch rapid saves into one write (max delay 1s)
        this.savePending = true;
        if (!this.saveTimer) {
            this.saveTimer = setTimeout(() => {
                this.flushToDisk();
                this.saveTimer = null;
            }, 1000);
        }
    }
    /** Force immediate write (call on shutdown). */
    flush() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        if (this.savePending) {
            this.flushToDisk();
        }
    }
    flushToDisk() {
        const desiresPath = path.join(this.dataDir, 'desires.json');
        const outcomesPath = path.join(this.dataDir, 'outcomes.json');
        const statePath = path.join(this.dataDir, 'state.json');
        fs.writeFileSync(desiresPath, JSON.stringify(Array.from(this.desires.values()), null, 2));
        fs.writeFileSync(outcomesPath, JSON.stringify(this.outcomes, null, 2));
        fs.writeFileSync(statePath, JSON.stringify(this.state, null, 2));
        this.savePending = false;
    }
    loadDesires() {
        const filePath = path.join(this.dataDir, 'desires.json');
        const map = new Map();
        if (fs.existsSync(filePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                for (const d of data)
                    map.set(d.id, d);
            }
            catch { /* start fresh */ }
        }
        return map;
    }
    loadOutcomes() {
        const filePath = path.join(this.dataDir, 'outcomes.json');
        if (fs.existsSync(filePath)) {
            try {
                return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            }
            catch { /* start fresh */ }
        }
        return [];
    }
    loadState() {
        const filePath = path.join(this.dataDir, 'state.json');
        if (fs.existsSync(filePath)) {
            try {
                return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            }
            catch { /* start fresh */ }
        }
        return {
            baseline_motivation: 0.6,
            idle_since: new Date().toISOString(),
            idle_duration_seconds: 0,
            mode: EngineMode.WAITING,
            recent_success_rate: 0.5,
            total_cycles: 0,
            last_cycle_at: new Date().toISOString(),
            depression_floor_count: 0,
        };
    }
}
function generateId() {
    return `desire_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}
