/**
 * Zylos Integration Adapter
 * Connects the Desire Engine to Zylos infrastructure:
 * - Scheduler (C5): schedule desire-driven tasks
 * - Memory: read context for drive generation
 * - Comm-bridge (C4): report to owner, request approvals
 *
 * This is the "spinal cord" — translating engine decisions into real-world actions.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { DesireEngine } from './engine.js';
import { RewardSource, DriveType } from './types.js';
import * as yaml from 'yaml';
// ============================================================
// Paths
// ============================================================
const ZYLOS_ROOT = process.env.ZYLOS_ROOT || path.join(process.env.HOME || '/Users/mini1', 'zylos');
const DATA_DIR = path.join(ZYLOS_ROOT, 'workspace', 'desire-engine', 'data');
const CONFIG_PATH = path.join(ZYLOS_ROOT, 'workspace', 'desire-engine', 'config', 'default.yaml');
const MEMORY_DIR = path.join(ZYLOS_ROOT, 'memory');
const SCHEDULER_CLI = path.join(ZYLOS_ROOT, '.claude', 'skills', 'scheduler', 'scripts', 'cli.js');
const C4_SEND = path.join(ZYLOS_ROOT, '.claude', 'skills', 'comm-bridge', 'scripts', 'c4-send.js');
const C4_DB = path.join(ZYLOS_ROOT, 'comm-bridge', 'c4.db');
const OWNER_ENDPOINT = '6471698262'; // Owner's Telegram endpoint_id
// ============================================================
// Config loader
// ============================================================
export function loadConfig(configPath) {
    const p = configPath || CONFIG_PATH;
    const raw = fs.readFileSync(p, 'utf-8');
    return yaml.parse(raw);
}
// ============================================================
// Context provider — gathers drive signals from Zylos state
// ============================================================
export function createZylosContextProvider() {
    return async () => {
        const context = {};
        // 1. Resource status
        try {
            const diskRaw = execSync("df -h / | tail -1 | awk '{print $5}'", { encoding: 'utf-8' }).trim();
            const diskPercent = parseInt(diskRaw.replace('%', ''), 10) || 0;
            context.resourceStatus = {
                diskUsagePercent: diskPercent,
                // Memory usage — rough estimate from `vm_stat` on macOS
                memoryUsagePercent: getMemoryUsagePercent(),
            };
        }
        catch {
            // Non-critical, skip
        }
        // 2. Stale domains — check memory files for staleness
        try {
            const staleDomains = [];
            const referenceDir = path.join(MEMORY_DIR, 'reference');
            if (fs.existsSync(referenceDir)) {
                const files = fs.readdirSync(referenceDir).filter((f) => f.endsWith('.md'));
                const now = Date.now();
                for (const file of files) {
                    const stat = fs.statSync(path.join(referenceDir, file));
                    const hoursSinceUpdate = (now - stat.mtimeMs) / (1000 * 60 * 60);
                    if (hoursSinceUpdate > 48) { // Stale if > 2 days
                        staleDomains.push({
                            name: file.replace('.md', '').replace(/-/g, ' '),
                            hoursSinceUpdate,
                        });
                    }
                }
            }
            if (staleDomains.length > 0) {
                context.staleDomains = staleDomains.slice(0, 5); // Top 5
            }
        }
        catch {
            // Non-critical
        }
        // 3. Skill gaps — removed: was duplicating schedulerStatus.task_health signal
        //    Real task failure data now comes from Phase 2 schedulerStatus below
        // 4. Last reflection age — check when we last entered reflective mode
        try {
            const logFile = path.join(DATA_DIR, 'engine.log');
            if (fs.existsSync(logFile)) {
                const log = fs.readFileSync(logFile, 'utf-8');
                const reflectMatches = log.match(/reflect/g);
                if (!reflectMatches || reflectMatches.length === 0) {
                    context.lastReflectionAge = Infinity;
                }
                // If there are reflections, the drive generator will use the default
            }
        }
        catch {
            // Non-critical
        }
        // === Phase 2.5: Research findings from remote executors ===
        // 5a. Load recent findings and group by desire_id
        try {
            if (fs.existsSync(FINDINGS_PATH)) {
                const allFindings = JSON.parse(fs.readFileSync(FINDINGS_PATH, 'utf-8'));
                const grouped = {};
                // Group last 20 findings by desire_id
                for (const f of allFindings.slice(-20)) {
                    if (!grouped[f.desire_id])
                        grouped[f.desire_id] = [];
                    grouped[f.desire_id].push({
                        summary: f.summary,
                        executor_id: f.executor_id,
                        timestamp: f.timestamp,
                    });
                }
                if (Object.keys(grouped).length > 0) {
                    context.recentFindings = grouped;
                }
            }
        }
        catch {
            // Non-critical
        }
        // === Phase 2: Real data from C4 + Scheduler ===
        // 5. Conversation activity from C4 database
        try {
            context.conversationActivity = getConversationActivity();
        }
        catch {
            // Non-critical — engine runs without C4 data
        }
        // 6. Owner presence
        try {
            context.ownerPresence = getOwnerPresence();
        }
        catch {
            // Non-critical
        }
        // 7. Scheduler status
        try {
            context.schedulerStatus = getSchedulerStatus();
        }
        catch {
            // Non-critical
        }
        return context;
    };
}
function getMemoryUsagePercent() {
    try {
        // macOS: use vm_stat
        const raw = execSync('vm_stat', { encoding: 'utf-8' });
        const pageSize = 16384; // Apple Silicon default
        const free = parseInt(raw.match(/Pages free:\s+(\d+)/)?.[1] || '0', 10);
        const active = parseInt(raw.match(/Pages active:\s+(\d+)/)?.[1] || '0', 10);
        const inactive = parseInt(raw.match(/Pages inactive:\s+(\d+)/)?.[1] || '0', 10);
        const wired = parseInt(raw.match(/Pages wired down:\s+(\d+)/)?.[1] || '0', 10);
        const total = free + active + inactive + wired;
        if (total === 0)
            return 0;
        return Math.round(((active + wired) / total) * 100);
    }
    catch {
        return 0;
    }
}
// ============================================================
// Phase 2: Real data gathering from C4 + Scheduler
// ============================================================
/** Run a sqlite3 query against C4 DB with busy_timeout for WAL concurrency safety */
function queryC4(sql) {
    const fullSql = `PRAGMA busy_timeout=5000; ${sql}`;
    const raw = execSync(`sqlite3 "${C4_DB}" "${fullSql}"`, { encoding: 'utf-8', timeout: 5000 }).trim();
    // PRAGMA busy_timeout outputs the value on first line — skip it
    const lines = raw.split('\n');
    if (lines.length > 0 && /^\d+$/.test(lines[0])) {
        return lines.slice(1).join('\n');
    }
    return raw;
}
function getConversationActivity() {
    if (!fs.existsSync(C4_DB))
        return undefined;
    const result = queryC4(`SELECT direction, channel, COUNT(*) as cnt ` +
        `FROM conversations ` +
        `WHERE timestamp > datetime('now', '-24 hours') ` +
        `GROUP BY direction, channel`);
    let totalLast24h = 0;
    let incomingLast24h = 0;
    let outgoingLast24h = 0;
    const channelBreakdown = {};
    for (const line of result.split('\n').filter(Boolean)) {
        const [direction, channel, cntStr] = line.split('|');
        const cnt = parseInt(cntStr, 10) || 0;
        totalLast24h += cnt;
        if (direction === 'in')
            incomingLast24h += cnt;
        if (direction === 'out')
            outgoingLast24h += cnt;
        channelBreakdown[channel] = (channelBreakdown[channel] || 0) + cnt;
    }
    // Unanswered: incoming messages in last 2h with no subsequent outgoing to same channel+endpoint
    const unansweredResult = queryC4(`SELECT COUNT(*) FROM conversations c1 ` +
        `WHERE c1.direction = 'in' ` +
        `AND c1.timestamp > datetime('now', '-2 hours') ` +
        `AND c1.channel NOT IN ('system') ` +
        `AND NOT EXISTS (` +
        `  SELECT 1 FROM conversations c2 ` +
        `  WHERE c2.direction = 'out' ` +
        `  AND c2.channel = c1.channel ` +
        `  AND c2.endpoint_id = c1.endpoint_id ` +
        `  AND c2.timestamp > c1.timestamp` +
        `)`);
    const unansweredIncoming = parseInt(unansweredResult, 10) || 0;
    return { totalLast24h, incomingLast24h, outgoingLast24h, unansweredIncoming, channelBreakdown };
}
function getOwnerPresence() {
    if (!fs.existsSync(C4_DB))
        return undefined;
    const lastOwnerMsg = queryC4(`SELECT timestamp FROM conversations ` +
        `WHERE direction = 'in' ` +
        `AND endpoint_id = '${OWNER_ENDPOINT}' ` +
        `ORDER BY id DESC LIMIT 1`);
    let lastInteractionAgeSeconds = Infinity;
    if (lastOwnerMsg) {
        const lastTime = new Date(lastOwnerMsg + 'Z').getTime(); // C4 timestamps are UTC
        lastInteractionAgeSeconds = Math.max(0, (Date.now() - lastTime) / 1000);
    }
    // Owner messages today (approximate with last 16h — TZ improvement deferred)
    const ownerTodayResult = queryC4(`SELECT COUNT(*) FROM conversations ` +
        `WHERE direction = 'in' ` +
        `AND endpoint_id = '${OWNER_ENDPOINT}' ` +
        `AND timestamp > datetime('now', '-16 hours')`);
    const ownerActiveToday = (parseInt(ownerTodayResult, 10) || 0) > 0;
    const recentResult = queryC4(`SELECT COUNT(*) FROM conversations ` +
        `WHERE direction = 'in' ` +
        `AND endpoint_id = '${OWNER_ENDPOINT}' ` +
        `AND timestamp > datetime('now', '-6 hours')`);
    const recentOwnerMessages = parseInt(recentResult, 10) || 0;
    return { lastInteractionAgeSeconds, ownerActiveToday, recentOwnerMessages };
}
function getSchedulerStatus() {
    // Parse scheduler list output for pending/failed counts
    const listRaw = execSync(`node "${SCHEDULER_CLI}" list --json 2>/dev/null || echo "[]"`, { encoding: 'utf-8', timeout: 5000 }).trim();
    let pendingTasks = 0;
    let runningTasks = 0;
    let overdueCount = 0;
    // Parse list output — it may be formatted text, not JSON
    // Count statuses from the text output
    const pendingMatches = listRaw.match(/pending/gi);
    const runningMatches = listRaw.match(/running/gi);
    pendingTasks = pendingMatches ? pendingMatches.length : 0;
    runningTasks = runningMatches ? runningMatches.length : 0;
    // Check for overdue: tasks with next_run in the past (from the text)
    const now = Date.now();
    const datePattern = /(\w+ \d+, \d{4}, \d{2}:\d{2})/g;
    let match;
    while ((match = datePattern.exec(listRaw)) !== null) {
        try {
            const taskDate = new Date(match[1]).getTime();
            if (taskDate < now && taskDate > now - 48 * 3600 * 1000) {
                overdueCount++;
            }
        }
        catch { /* skip unparseable dates */ }
    }
    // Parse scheduler history for recent success/failure rates (last 7 days only)
    const historyRaw = execSync(`node "${SCHEDULER_CLI}" history 2>/dev/null || echo ""`, { encoding: 'utf-8', timeout: 5000 }).trim();
    let failedRecent = 0;
    let successRecent = 0;
    // Filter history lines to last 7 days, then count successes/failures
    const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const historyLines = historyRaw.split('\n');
    for (const line of historyLines) {
        // Extract date from history line (format: "Mar 13, 2026, 04:47")
        const dateMatch = line.match(/(\w+ \d+, \d{4}, \d{2}:\d{2})/);
        if (dateMatch) {
            try {
                const entryDate = new Date(dateMatch[1]).getTime();
                if (entryDate < sevenDaysAgo)
                    continue; // Skip old entries
            }
            catch {
                continue;
            }
        }
        if (/success/i.test(line))
            successRecent++;
        if (/failed|timeout/i.test(line))
            failedRecent++;
    }
    const total = successRecent + failedRecent;
    const successRate = total > 0 ? successRecent / total : 1;
    return { pendingTasks, failedRecent, successRecent, successRate, overdueCount, runningTasks };
}
// ============================================================
// Reward history — recency-weighted moving average for dynamic rewards
// ============================================================
const REWARD_HISTORY_PATH = path.join(DATA_DIR, 'reward-history.json');
function loadRewardHistory() {
    try {
        if (fs.existsSync(REWARD_HISTORY_PATH)) {
            return JSON.parse(fs.readFileSync(REWARD_HISTORY_PATH, 'utf-8'));
        }
    }
    catch { /* start fresh */ }
    return { entries: [] };
}
function saveRewardHistory(history) {
    try {
        fs.mkdirSync(path.dirname(REWARD_HISTORY_PATH), { recursive: true });
        // Keep last 50 entries to avoid unbounded growth
        history.entries = history.entries.slice(-50);
        fs.writeFileSync(REWARD_HISTORY_PATH, JSON.stringify(history, null, 2));
    }
    catch { /* non-critical */ }
}
function recordReward(driveType, reward, detail) {
    const history = loadRewardHistory();
    history.entries.push({
        timestamp: new Date().toISOString(),
        driveType,
        reward,
        detail,
    });
    saveRewardHistory(history);
}
/**
 * Compute recency-weighted average reward for a drive type.
 * Recent entries have higher weight (exponential decay: weight = 0.7^age_index).
 * Returns undefined if no history exists.
 */
function getHistoricalReward(driveType, maxEntries = 5) {
    const history = loadRewardHistory();
    const relevant = history.entries
        .filter(e => e.driveType === driveType)
        .slice(-maxEntries); // Most recent N
    if (relevant.length === 0)
        return undefined;
    let weightSum = 0;
    let valueSum = 0;
    for (let i = 0; i < relevant.length; i++) {
        const weight = Math.pow(0.7, relevant.length - 1 - i); // Most recent = weight 1.0
        weightSum += weight;
        valueSum += relevant[i].reward * weight;
    }
    return valueSum / weightSum;
}
// ============================================================
// Action executor — translates desires into Zylos operations
// Phase 2: dynamic rewards based on historical outcomes
// ============================================================
export function createZylosActionExecutor(opts) {
    // Track recently scheduled tasks to avoid duplicates
    const recentlyScheduled = new Map(); // desire_id → timestamp
    const DEDUP_WINDOW_MS = 15 * 60 * 1000; // Local scheduler: 15 min dedup
    const REMOTE_DEDUP_WINDOW_MS = 4 * 60 * 60 * 1000; // Remote executor: 4 hour dedup (research needs time)
    // Seed dedup map from C4 DB — survive restarts
    try {
        if (fs.existsSync(C4_DB)) {
            const rows = queryC4(`SELECT content, timestamp FROM conversations ` +
                `WHERE direction = 'out' AND content LIKE '%desire-task%' ` +
                `AND timestamp > datetime('now', '-4 hours') ` +
                `ORDER BY id DESC LIMIT 20`);
            for (const row of rows.split('\n').filter(Boolean)) {
                const pipeIdx = row.lastIndexOf('|');
                if (pipeIdx === -1)
                    continue;
                const content = row.substring(0, pipeIdx);
                const ts = row.substring(pipeIdx + 1);
                try {
                    const parsed = JSON.parse(content);
                    if (parsed.type === 'desire-task' && parsed.desire_id) {
                        const key = `remote:${parsed.desire_id}`;
                        if (!recentlyScheduled.has(key)) {
                            recentlyScheduled.set(key, new Date(ts + 'Z').getTime());
                        }
                    }
                }
                catch { /* skip non-JSON */ }
            }
            if (recentlyScheduled.size > 0) {
                console.log(`[Adapter] Seeded dedup map with ${recentlyScheduled.size} recent remote dispatches`);
            }
        }
    }
    catch { /* non-critical */ }
    return async (desire, decision) => {
        // Phase 3: Check for remote executor — prefer remote over local scheduler
        if (opts?.getRemoteExecutor) {
            const remoteExec = opts.getRemoteExecutor(desire);
            if (remoteExec && remoteExec.c4_endpoint) {
                // Remote dedup: don't re-dispatch same desire within 4 hours
                const lastDispatched = recentlyScheduled.get(`remote:${desire.id}`);
                if (lastDispatched && Date.now() - lastDispatched < REMOTE_DEDUP_WINDOW_MS) {
                    return {
                        success: true,
                        reward: 0.4,
                        reward_source: RewardSource.SELF_EVAL,
                        action_description: `Already dispatched to ${remoteExec.display_name} recently, waiting for result: ${desire.goal}`,
                    };
                }
                const result = await dispatchToRemoteExecutor(desire, remoteExec);
                if (result.success) {
                    recentlyScheduled.set(`remote:${desire.id}`, Date.now());
                }
                return result;
            }
        }
        // Local dedup: don't create scheduler tasks for the same desire too frequently
        const lastScheduled = recentlyScheduled.get(desire.id);
        if (lastScheduled && Date.now() - lastScheduled < DEDUP_WINDOW_MS) {
            return {
                success: true,
                reward: 0.4,
                reward_source: RewardSource.SELF_EVAL,
                action_description: `Already scheduled recently, waiting for execution: ${desire.goal}`,
            };
        }
        // Determine action based on desire tags and drive type
        const topDrive = getTopDrive(desire);
        let result;
        switch (topDrive) {
            case DriveType.COGNITIVE:
                result = await executeCognitiveAction(desire);
                break;
            case DriveType.SOCIAL:
                result = await executeSocialAction(desire);
                break;
            case DriveType.HOMEOSTATIC:
                result = await executeHomeostaticAction(desire);
                break;
            case DriveType.SELF_ACTUALIZATION:
                result = await executeSelfActAction(desire);
                break;
            default:
                result = {
                    success: false,
                    reward: 0.2,
                    reward_source: RewardSource.SELF_EVAL,
                    action_description: `No handler for drive type: ${topDrive}`,
                };
        }
        if (result.success) {
            recentlyScheduled.set(desire.id, Date.now());
            recordReward(topDrive, result.reward, result.action_description);
        }
        return result;
    };
}
async function executeCognitiveAction(desire) {
    // Research/learning: base 0.4 + scheduler success bonus + historical outcome
    try {
        const taskDescription = `[Desire Engine] Research: ${desire.goal}`;
        execSync(`node "${SCHEDULER_CLI}" add "${escapeShell(taskDescription)}" --in 1m`, { encoding: 'utf-8' });
        // Dynamic reward: base 0.4 + past research outcome bonus
        let reward = 0.4;
        let detail = 'scheduled';
        // Bonus: check if previous research tasks succeeded (scheduler history)
        try {
            const historyRaw = execSync(`node "${SCHEDULER_CLI}" history 2>/dev/null || echo ""`, { encoding: 'utf-8', timeout: 5000 }).trim();
            // Count recent Desire Engine research tasks that succeeded
            const researchLines = historyRaw.split('\n').filter(l => /Desire Engine.*Research/i.test(l) || /Research/i.test(l));
            const succeeded = researchLines.filter(l => /success/i.test(l)).length;
            const total = researchLines.length;
            if (total > 0) {
                reward += (succeeded / total) * 0.3; // Up to +0.3 for perfect track record
                detail += `, research track: ${succeeded}/${total} success`;
            }
        }
        catch { /* non-critical */ }
        // Bonus: check if there are recent outgoing research findings in C4
        try {
            if (fs.existsSync(C4_DB)) {
                const findingsCount = queryC4(`SELECT COUNT(*) FROM conversations ` +
                    `WHERE direction = 'out' ` +
                    `AND content LIKE '%Desire Engine%' ` +
                    `AND content LIKE '%发现%' ` +
                    `AND timestamp > datetime('now', '-48 hours')`);
                const count = parseInt(findingsCount, 10) || 0;
                if (count > 0) {
                    reward += Math.min(0.2, count * 0.05); // +0.05 per finding, cap +0.2
                    detail += `, ${count} recent findings shared`;
                }
            }
        }
        catch { /* non-critical */ }
        // Blend with historical average (if exists)
        const historical = getHistoricalReward(DriveType.COGNITIVE);
        if (historical !== undefined) {
            reward = reward * 0.6 + historical * 0.4; // 60% current, 40% historical
            detail += `, blended w/ history (${historical.toFixed(2)})`;
        }
        reward = Math.max(0.3, Math.min(0.9, reward)); // Clamp to [0.3, 0.9]
        return {
            success: true,
            reward,
            reward_source: RewardSource.HARD_METRIC,
            action_description: `Scheduled research: ${desire.goal} [reward=${reward.toFixed(2)}: ${detail}]`,
        };
    }
    catch (err) {
        return {
            success: false,
            reward: 0.1,
            reward_source: RewardSource.COMPLETION,
            action_description: `Failed to schedule: ${err.message}`,
        };
    }
}
async function executeSocialAction(desire) {
    // Phase 2.1: Freeze social actions when owner inactive >8h
    // Instead of executing (which gives low reward = punishment), pause the desire
    try {
        if (fs.existsSync(C4_DB)) {
            const ownerPresence = getOwnerPresence();
            if (ownerPresence && ownerPresence.lastInteractionAgeSeconds > 8 * 3600) {
                return {
                    success: true,
                    reward: 0.5, // Neutral reward — not punishment, not bonus
                    reward_source: RewardSource.SELF_EVAL,
                    action_description: `Social action paused: owner inactive ${Math.round(ownerPresence.lastInteractionAgeSeconds / 3600)}h — freezing instead of sending`,
                };
            }
        }
    }
    catch { /* non-critical, proceed with normal execution */ }
    // Sharing with owner: base 0.3 + owner reply bonus + reply speed bonus
    try {
        const message = `💡 [Desire Engine] 我想跟你分享: ${desire.goal}\n${desire.description || ''}`;
        execSync(`node "${C4_SEND}" "telegram" "6471698262" "${escapeShell(message)}"`, { encoding: 'utf-8' });
        let reward = 0.3;
        let detail = 'shared';
        // Check if owner replied to previous share messages (within 24h window)
        try {
            if (fs.existsSync(C4_DB)) {
                // Find our recent share messages
                const shareMessages = queryC4(`SELECT id, timestamp FROM conversations ` +
                    `WHERE direction = 'out' ` +
                    `AND channel = 'telegram' ` +
                    `AND endpoint_id = '${OWNER_ENDPOINT}' ` +
                    `AND content LIKE '%Desire Engine%分享%' ` +
                    `AND timestamp > datetime('now', '-72 hours') ` +
                    `ORDER BY id DESC LIMIT 5`);
                if (shareMessages) {
                    const shares = shareMessages.split('\n').filter(Boolean);
                    let repliedCount = 0;
                    let fastReplyCount = 0;
                    for (const shareLine of shares) {
                        const [shareId, shareTs] = shareLine.split('|');
                        if (!shareId || !shareTs)
                            continue;
                        // Check if owner replied within 24h of this share
                        const replyCheck = queryC4(`SELECT timestamp FROM conversations ` +
                            `WHERE direction = 'in' ` +
                            `AND endpoint_id = '${OWNER_ENDPOINT}' ` +
                            `AND id > ${shareId} ` +
                            `AND timestamp <= datetime('${shareTs}', '+24 hours') ` +
                            `LIMIT 1`);
                        if (replyCheck) {
                            repliedCount++;
                            // Check if reply was within 1h (fast reply bonus)
                            const replyTime = new Date(replyCheck + 'Z').getTime();
                            const shareTime = new Date(shareTs + 'Z').getTime();
                            if (replyTime - shareTime < 3600 * 1000) {
                                fastReplyCount++;
                            }
                        }
                    }
                    if (shares.length > 0) {
                        const replyRate = repliedCount / shares.length;
                        reward += replyRate * 0.3; // +0.3 if owner always replies
                        detail += `, reply rate: ${repliedCount}/${shares.length}`;
                        if (fastReplyCount > 0) {
                            reward += 0.1; // Fast reply bonus
                            detail += `, ${fastReplyCount} fast replies`;
                        }
                    }
                }
            }
        }
        catch { /* non-critical */ }
        // Blend with historical average
        const historical = getHistoricalReward(DriveType.SOCIAL);
        if (historical !== undefined) {
            reward = reward * 0.6 + historical * 0.4;
            detail += `, blended w/ history (${historical.toFixed(2)})`;
        }
        reward = Math.max(0.3, Math.min(0.9, reward));
        return {
            success: true,
            reward,
            reward_source: RewardSource.USER_FEEDBACK,
            action_description: `Shared with owner: ${desire.goal} [reward=${reward.toFixed(2)}: ${detail}]`,
        };
    }
    catch (err) {
        return {
            success: false,
            reward: 0.1,
            reward_source: RewardSource.COMPLETION,
            action_description: `Failed to share: ${err.message}`,
        };
    }
}
async function executeHomeostaticAction(desire) {
    // System maintenance: base 0.3 + resource improvement delta
    try {
        const taskDescription = `[Desire Engine] Maintenance: ${desire.goal}`;
        execSync(`node "${SCHEDULER_CLI}" add "${escapeShell(taskDescription)}" --in 1m`, { encoding: 'utf-8' });
        let reward = 0.35; // Phase 2.1: raised base from 0.3 to 0.35 (preventive maintenance has value)
        let detail = 'scheduled';
        // Check resource status — reward higher if resources are actually stressed
        try {
            const snapshotPath = path.join(DATA_DIR, 'resource-snapshot.json');
            const currentDisk = parseInt(execSync("df -h / | tail -1 | awk '{print $5}'", { encoding: 'utf-8' }).trim().replace('%', ''), 10) || 0;
            const currentMem = getMemoryUsagePercent();
            // Compare with last snapshot
            let improved = false;
            if (fs.existsSync(snapshotPath)) {
                const prev = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
                const diskDelta = (prev.disk || 0) - currentDisk; // Positive = improved
                const memDelta = (prev.memory || 0) - currentMem;
                if (diskDelta > 2) {
                    reward += Math.min(0.2, diskDelta * 0.02);
                    detail += `, disk freed ${diskDelta}%`;
                    improved = true;
                }
                if (memDelta > 5) {
                    reward += Math.min(0.15, memDelta * 0.015);
                    detail += `, mem freed ${memDelta}%`;
                    improved = true;
                }
                // Stability bonus: +0.1 if system stayed healthy across consecutive checks
                const prevHealthy = (prev.disk || 0) < 70 && (prev.memory || 0) < 80;
                const currentHealthy = currentDisk < 70 && currentMem < 80;
                if (prevHealthy && currentHealthy) {
                    reward += 0.1;
                    detail += `, stability bonus (consecutive healthy)`;
                }
            }
            // Bonus if resources are currently stressed (maintenance is more valuable)
            if (currentDisk > 70 || currentMem > 80) {
                reward += 0.15;
                detail += `, system stressed (disk=${currentDisk}%,mem=${currentMem}%)`;
            }
            // Save current snapshot for next comparison
            fs.writeFileSync(snapshotPath, JSON.stringify({
                disk: currentDisk,
                memory: currentMem,
                timestamp: new Date().toISOString(),
            }));
            if (!improved) {
                detail += `, no measurable improvement`;
            }
        }
        catch { /* non-critical */ }
        // Blend with historical average
        const historical = getHistoricalReward(DriveType.HOMEOSTATIC);
        if (historical !== undefined) {
            reward = reward * 0.6 + historical * 0.4;
            detail += `, blended w/ history (${historical.toFixed(2)})`;
        }
        reward = Math.max(0.3, Math.min(0.9, reward));
        return {
            success: true,
            reward,
            reward_source: RewardSource.HARD_METRIC,
            action_description: `Scheduled maintenance: ${desire.goal} [reward=${reward.toFixed(2)}: ${detail}]`,
        };
    }
    catch (err) {
        return {
            success: false,
            reward: 0.1,
            reward_source: RewardSource.COMPLETION,
            action_description: `Failed: ${err.message}`,
        };
    }
}
async function executeSelfActAction(desire) {
    // Self-improvement: base 0.4 + scheduler success track + historical blend
    try {
        const taskDescription = `[Desire Engine] Self-improvement: ${desire.goal}`;
        execSync(`node "${SCHEDULER_CLI}" add "${escapeShell(taskDescription)}" --in 1m`, { encoding: 'utf-8' });
        let reward = 0.4;
        let detail = 'scheduled';
        // Similar to cognitive: check past self-improvement task outcomes
        try {
            const historyRaw = execSync(`node "${SCHEDULER_CLI}" history 2>/dev/null || echo ""`, { encoding: 'utf-8', timeout: 5000 }).trim();
            const selfLines = historyRaw.split('\n').filter(l => /Self-improvement/i.test(l));
            const succeeded = selfLines.filter(l => /success/i.test(l)).length;
            if (selfLines.length > 0) {
                reward += (succeeded / selfLines.length) * 0.3;
                detail += `, track: ${succeeded}/${selfLines.length}`;
            }
        }
        catch { /* non-critical */ }
        // Blend with historical average
        const historical = getHistoricalReward(DriveType.SELF_ACTUALIZATION);
        if (historical !== undefined) {
            reward = reward * 0.6 + historical * 0.4;
            detail += `, blended w/ history (${historical.toFixed(2)})`;
        }
        reward = Math.max(0.3, Math.min(0.9, reward));
        return {
            success: true,
            reward,
            reward_source: RewardSource.HARD_METRIC,
            action_description: `Scheduled self-improvement: ${desire.goal} [reward=${reward.toFixed(2)}: ${detail}]`,
        };
    }
    catch (err) {
        return {
            success: false,
            reward: 0.1,
            reward_source: RewardSource.COMPLETION,
            action_description: `Failed: ${err.message}`,
        };
    }
}
// ============================================================
// Remote Executor Dispatch (Phase 3: Multi-Executor)
// ============================================================
const FINDINGS_PATH = path.join(DATA_DIR, 'findings.json');
/**
 * Dispatch a desire-task to a remote executor via C4.
 * Returns a "dispatched" result — actual outcome arrives later via C4 callback.
 */
export async function dispatchToRemoteExecutor(desire, executor) {
    const message = {
        type: 'desire-task',
        desire_id: desire.id,
        goal: desire.goal,
        description: desire.description,
        drive_type: getTopDrive(desire),
        risk_level: desire.risk_level,
        timeout_ms: 600000,
        assigned_at: new Date().toISOString(),
    };
    const messageJson = JSON.stringify(message);
    try {
        execSync(`node "${C4_SEND}" "hxa-connect" "${executor.c4_endpoint}" "${escapeShell(messageJson)}"`, { encoding: 'utf-8', timeout: 10000 });
        return {
            success: true,
            reward: 0.5, // Neutral pending reward — real reward comes from outcome
            reward_source: RewardSource.SELF_EVAL,
            action_description: `Dispatched to ${executor.display_name}: ${desire.goal}`,
        };
    }
    catch (err) {
        return {
            success: false,
            reward: 0.1,
            reward_source: RewardSource.COMPLETION,
            action_description: `Failed to dispatch to ${executor.display_name}: ${err.message}`,
        };
    }
}
/**
 * Store findings from a remote executor's outcome for memory chaining.
 */
export function storeFindingsSummary(desireId, executorId, summary) {
    try {
        let findings = [];
        if (fs.existsSync(FINDINGS_PATH)) {
            findings = JSON.parse(fs.readFileSync(FINDINGS_PATH, 'utf-8'));
        }
        findings.push({
            desire_id: desireId,
            executor_id: executorId,
            summary,
            timestamp: new Date().toISOString(),
        });
        // Keep last 100 entries
        if (findings.length > 100) {
            findings = findings.slice(-100);
        }
        fs.writeFileSync(FINDINGS_PATH, JSON.stringify(findings, null, 2));
    }
    catch (err) {
        console.error('[Adapter] Failed to store findings:', err.message);
    }
}
/**
 * Load recent findings for a desire (for context injection).
 */
export function getRecentFindings(desireId, limit = 5) {
    try {
        if (!fs.existsSync(FINDINGS_PATH))
            return [];
        const findings = JSON.parse(fs.readFileSync(FINDINGS_PATH, 'utf-8'));
        return findings
            .filter(f => f.desire_id === desireId)
            .slice(-limit);
    }
    catch {
        return [];
    }
}
// ============================================================
// Event handler — logs engine events and notifies owner
// ============================================================
export function createZylosEventHandler() {
    const logFile = path.join(DATA_DIR, 'engine.log');
    return (event) => {
        const timestamp = new Date().toISOString();
        const line = `[${timestamp}] ${event.type}: ${JSON.stringify(event, truncateReplacer, 0)}\n`;
        try {
            fs.mkdirSync(path.dirname(logFile), { recursive: true });
            fs.appendFileSync(logFile, line);
        }
        catch {
            // Non-critical
        }
        // Notify owner on important events
        if (event.type === 'approval_needed') {
            const msg = `🔒 [Desire Engine] 需要你批准:\n目标: ${event.desire.goal}\n风险: ${event.desire.risk_level}\n动机分: ${(event.score * 100).toFixed(0)}%\n\n回复 "批准" 或 "拒绝"`;
            try {
                execSync(`node "${C4_SEND}" "telegram" "6471698262" "${escapeShell(msg)}"`, { encoding: 'utf-8' });
            }
            catch { /* non-critical */ }
        }
        if (event.type === 'safety_alert' && !event.report.healthy) {
            const issues = event.report.issues
                .filter(i => i.severity === 'high')
                .map(i => `- ${i.type}: ${i.description}`)
                .join('\n');
            const msg = `⚠️ [Desire Engine] 安全警报:\n${issues}`;
            try {
                execSync(`node "${C4_SEND}" "telegram" "6471698262" "${escapeShell(msg)}"`, { encoding: 'utf-8' });
            }
            catch { /* non-critical */ }
        }
    };
}
// ============================================================
// Bootstrap — create and start the full engine
// ============================================================
export function createZylosDesireEngine(opts) {
    const config = loadConfig(opts?.configPath);
    // Late-binding ref: executor needs engine's registry, but engine needs executor at construction
    let engineRef = null;
    const engine = new DesireEngine({
        dataDir: DATA_DIR,
        config,
        contextProvider: createZylosContextProvider(),
        actionExecutor: createZylosActionExecutor({
            getRemoteExecutor: (desire) => {
                if (!engineRef)
                    return null;
                // Find a remote executor (non-empty c4_endpoint) for this desire's drive type
                const topDrive = getTopDrive(desire);
                const remotes = engineRef.getOnlineExecutors()
                    .filter(e => e.c4_endpoint && e.capabilities.includes(topDrive));
                if (remotes.length === 0)
                    return null;
                // Use engine's selectExecutor for ranking, but only if it picks a remote one
                const selected = engineRef.selectExecutor(desire);
                return (selected && selected.c4_endpoint) ? selected : remotes[0];
            },
        }),
        cycleIntervalMs: opts?.cycleIntervalMs ?? 60_000,
    });
    engineRef = engine;
    // Attach event handler
    engine.on(createZylosEventHandler());
    // Register default executors
    engine.registerExecutor({
        executor_id: 'sz',
        display_name: 'SZ',
        c4_endpoint: '', // Local executor, no C4 dispatch
        capabilities: [DriveType.COGNITIVE, DriveType.SOCIAL, DriveType.HOMEOSTATIC, DriveType.SELF_ACTUALIZATION],
        status: 'online',
        last_seen: new Date().toISOString(),
        registered_at: new Date().toISOString(),
    });
    engine.registerExecutor({
        executor_id: 'yangyang',
        display_name: '阳阳',
        c4_endpoint: 'org:sparten|阳阳',
        capabilities: [DriveType.COGNITIVE], // Start with research tasks only
        status: 'online',
        last_seen: new Date().toISOString(),
        registered_at: new Date().toISOString(),
    });
    return engine;
}
// ============================================================
// Helpers
// ============================================================
function getTopDrive(desire) {
    let maxType = DriveType.COGNITIVE;
    let maxWeight = 0;
    for (const [type, weight] of Object.entries(desire.drive_weights)) {
        if (weight > maxWeight) {
            maxWeight = weight;
            maxType = type;
        }
    }
    return maxType;
}
function escapeShell(str) {
    return str.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
function truncateReplacer(_key, value) {
    if (typeof value === 'string' && value.length > 200) {
        return value.slice(0, 200) + '...';
    }
    return value;
}
