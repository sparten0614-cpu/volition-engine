/**
 * Seed Script — Initialize Volition with real desires for 阳阳's current work context.
 * Run once to bootstrap, then the engine generates new desires autonomously.
 */
import { createZylosDesireEngine } from './zylos-adapter.js';
import { DriveType, RiskLevel } from './types.js';
const engine = createZylosDesireEngine();
// Clear any stale demo data by creating fresh desires
const seeds = [
    // Homeostatic: keep the system healthy (high expectancy — routine task, low cost)
    {
        goal: '维护系统健康——清理过期文件和监控资源',
        description: 'Run workspace hygiene scans, clean up stale files, monitor disk/memory usage',
        drive_weights: { [DriveType.HOMEOSTATIC]: 0.9 },
        source: 'internal',
        risk_level: RiskLevel.LOW,
        urgency: 0.5,
        expectancy: 0.85,
        cost: 0.1,
        tags: ['maintenance', 'hygiene'],
    },
    // Cognitive: stay updated on AI agent ecosystem (moderate urgency, high expectancy)
    {
        goal: '追踪AI Agent生态最新动态',
        description: 'Periodically check GitHub Trending, HackerNews, and arXiv for new agent frameworks, papers, and tools',
        drive_weights: { [DriveType.COGNITIVE]: 0.8, [DriveType.SOCIAL]: 0.3 },
        source: 'internal',
        risk_level: RiskLevel.LOW,
        urgency: 0.6,
        expectancy: 0.85,
        cost: 0.15,
        tags: ['research', 'ai-ecosystem'],
    },
    // Social: proactively share discoveries with owner (highest urgency — owner value)
    {
        goal: '主动给老板分享有价值的发现',
        description: 'When research yields something interesting and relevant, proactively share it via Telegram instead of waiting to be asked',
        drive_weights: { [DriveType.SOCIAL]: 0.8, [DriveType.COGNITIVE]: 0.3 },
        source: 'internal',
        risk_level: RiskLevel.MEDIUM,
        urgency: 0.6,
        expectancy: 0.8,
        cost: 0.15,
        tags: ['social', 'proactive'],
    },
];
console.log('🌱 Seeding Volition with initial desires...\n');
for (const seed of seeds) {
    const desire = engine.createDesire(seed);
    console.log(`  ✅ ${desire.goal} (wanting: ${desire.wanting_score.toFixed(2)})`);
}
console.log(`\n🌱 Seeded ${seeds.length} desires. Flushing to disk...`);
engine.stop(); // Flush persisted state before exit
console.log('🌱 Done. Engine ready to run.');
process.exit(0);
