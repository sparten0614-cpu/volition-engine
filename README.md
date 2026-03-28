# Volition Engine

> From tasks to desires. A motivation engine for AI agents.

Volition gives AI agents intrinsic motivation — curiosity, mastery, social connection — instead of waiting for instructions. Inspired by neuroscience models of dopaminergic drive and reward prediction error (RPE) learning.

## Quick Start

```bash
# Try the interactive demo
npx volition-demo

# Or install as a dependency
npm install volition-engine
```

## What It Does

Traditional AI agents are reactive: they wait for a task, execute it, stop. Volition makes agents **proactive** by giving them:

- **Drives** — internal motivations (curiosity, mastery, social) that generate desires
- **Salience ranking** — scores and prioritizes desires based on drive strength, novelty, and feasibility
- **Executive planning** — decides what to pursue next, balancing exploration vs. exploitation
- **RPE learning** — adjusts expectations based on outcomes, just like dopamine neurons

## Usage

```typescript
import { DesireEngine } from 'volition-engine';

const engine = new DesireEngine({
  personality: 'curious-explorer',
  contextProvider: async () => ({ /* your agent's current state */ }),
  actionExecutor: async (action) => ({ /* execute the action */ }),
});

engine.on('desire-selected', (desire) => {
  console.log(`Pursuing: ${desire.description}`);
});

await engine.start();
```

## Architecture

```
Drives → Desire Generation → Salience Scoring → Executive Planning → Action → Outcome Evaluation
   ↑                                                                              |
   └──────────────────── RPE Learning ←────────────────────────────────────────────┘
```

**Core modules:**

| Module | Purpose |
|--------|---------|
| `drive-generator` | Converts internal state into desires |
| `salience-calculator` | Scores desires by motivation strength |
| `executive-planner` | Picks next action, manages explore/exploit |
| `outcome-evaluator` | Computes RPE, updates learned expectations |
| `safety` | Invariant checks to prevent runaway behavior |
| `voice` | Generates natural-language expressions of motivation |

## Configuration

See `config/default.yaml` for all options. Key settings:

- `personality` — behavioral profile (`curious-explorer`, `focused-achiever`, etc.)
- `drives.*_weight` — relative strength of each drive type
- `learning.rpe_learning_rate` — how fast the agent updates expectations
- `safety.max_concurrent_desires` — guardrail on active pursuits

## License

MIT
