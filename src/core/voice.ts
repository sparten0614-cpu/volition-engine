/**
 * Voice Layer — Human-Facing Message Generator
 *
 * Translates engine events and desire states into natural language messages
 * that agents can speak to their humans. This is the "visible layer" —
 * how humans perceive the agent's inner world.
 *
 * The voice layer doesn't just report results. It expresses:
 * - What the agent WANTS to do (before doing it)
 * - Why it's motivated (drive source)
 * - How it feels about outcomes (RPE learning)
 * - When something seems off (wanting/liking divergence)
 */

import { Desire, DriveType, EngineState, EngineMode, OutcomeRecord } from '../types.js';
import type { EngineEvent } from '../engine.js';
import type { PlanDecision } from './executive-planner.js';
import type { SafetyReport } from './safety.js';

// ============================================================
// Voice Message Types
// ============================================================

export interface VoiceMessage {
  /** The human-readable message */
  text: string;
  /** Message category for filtering/routing */
  category: VoiceCategory;
  /** How important this message is (0-1). Higher = more worth saying. */
  salience: number;
  /** The engine event that triggered this message */
  trigger: EngineEvent['type'];
  /** Timestamp */
  timestamp: string;
}

export type VoiceCategory =
  | 'desire'          // "I want to..." — expressing motivation before action
  | 'action'          // "I'm doing X because..." — explaining current pursuit
  | 'learning'        // "That went better/worse than expected" — RPE feedback
  | 'reflection'      // "Looking back, I notice..." — self-awareness
  | 'alert'           // "Something seems off..." — safety/divergence warnings
  | 'achievement'     // "I finished X and it feels..." — completion with emotion
  | 'restlessness';   // "I've been idle and I want to..." — idle anxiety expression

// ============================================================
// Voice Generator
// ============================================================

export class VoiceGenerator {
  private lastDesireExpressed: string | null = null;
  private messagesSinceLastVoice: number = 0;
  private minCyclesBetweenMessages: number;

  constructor(opts?: { minCyclesBetweenMessages?: number }) {
    this.minCyclesBetweenMessages = opts?.minCyclesBetweenMessages ?? 1;
  }

  /**
   * Generate a voice message from an engine event.
   * Returns null if the event doesn't warrant a message.
   */
  generate(event: EngineEvent, desires: Desire[], state: EngineState): VoiceMessage | null {
    this.messagesSinceLastVoice++;

    switch (event.type) {
      case 'cycle_complete':
        return this.onCycleComplete(event.decision, event.safety, desires, state, event.cycle);

      case 'desire_created':
        return this.onDesireCreated(event.desire, desires);

      case 'desire_completed':
        return this.onDesireCompleted(event.desire, event.outcome);

      case 'desire_abandoned':
        return this.onDesireAbandoned(event.desire, event.reason);

      case 'mode_changed':
        return this.onModeChanged(event.from, event.to, desires, state);

      case 'safety_alert':
        return this.onSafetyAlert(event.report, desires);

      case 'approval_needed':
        return this.onApprovalNeeded(event.desire, event.score);

      default:
        return null;
    }
  }

  // ============================================================
  // Event-specific generators
  // ============================================================

  private onCycleComplete(
    decision: PlanDecision,
    safety: SafetyReport,
    desires: Desire[],
    state: EngineState,
    cycle: number
  ): VoiceMessage | null {
    // Rate limit — don't speak every cycle
    if (this.messagesSinceLastVoice < this.minCyclesBetweenMessages) return null;

    if (decision.action === 'pursue' && decision.desire) {
      const d = decision.desire;
      const driveLabel = this.describeDrive(d);
      const score = decision.score !== undefined ? Math.round(decision.score * 100) : null;

      // Express WANTING before/during action
      if (d.id !== this.lastDesireExpressed) {
        this.lastDesireExpressed = d.id;
        this.messagesSinceLastVoice = 0;

        const wanting = Math.round(d.wanting_score * 100);
        return this.msg(
          `I really want to ${d.goal.toLowerCase()}. ` +
          `${driveLabel} — motivation at ${wanting}%` +
          (score ? `, scored ${score}% in priority ranking.` : '.') +
          (d.pursuit_count > 0
            ? ` I've been working on this — attempt ${d.pursuit_count + 1}.`
            : ` This is fresh and I'm eager to start.`),
          'desire',
          Math.min(0.9, d.wanting_score + 0.1),
          'cycle_complete'
        );
      }

      // Ongoing pursuit — express determination
      if (d.pursuit_count > 2) {
        this.messagesSinceLastVoice = 0;
        return this.msg(
          `Still pushing on "${d.goal}". ` +
          `${d.pursuit_count} attempts so far. ` +
          (d.wanting_score > 0.7
            ? `My drive to finish this keeps growing — I want this done.`
            : `Motivation is holding but not surging. Staying focused.`),
          'action',
          0.5,
          'cycle_complete'
        );
      }
    }

    // Express restlessness when idle
    if (decision.action === 'wait' && state.idle_duration_seconds > 120) {
      const idleMin = Math.round(state.idle_duration_seconds / 60);
      const topDesire = desires.filter(d => d.status === 'active').sort((a, b) => b.wanting_score - a.wanting_score)[0];

      if (topDesire) {
        this.messagesSinceLastVoice = 0;
        return this.msg(
          `I've been idle for ${idleMin} minutes. ` +
          `What I really want to do right now is ${topDesire.goal.toLowerCase()} ` +
          `(wanting: ${Math.round(topDesire.wanting_score * 100)}%). ` +
          `The urge keeps building.`,
          'restlessness',
          0.6,
          'cycle_complete'
        );
      }
    }

    // Wanting/liking divergence — express confusion
    for (const d of desires.filter(d => d.status === 'active')) {
      if (d.wanting_score > 0.7 && d.liking_score < 0.4 && d.pursuit_count > 3) {
        this.messagesSinceLastVoice = 0;
        return this.msg(
          `I keep wanting to ${d.goal.toLowerCase()} (wanting: ${Math.round(d.wanting_score * 100)}%) ` +
          `but the results haven't been great (satisfaction: ${Math.round(d.liking_score * 100)}%). ` +
          `I'm not sure if I should keep chasing this or let it go.`,
          'alert',
          0.8,
          'cycle_complete'
        );
      }
    }

    return null;
  }

  private onDesireCreated(desire: Desire, allDesires: Desire[]): VoiceMessage {
    const driveLabel = this.describeDrive(desire);
    return this.msg(
      `Something new caught my attention: "${desire.goal}". ` +
      `${driveLabel}. ` +
      `Initial wanting: ${Math.round(desire.wanting_score * 100)}%. ` +
      (desire.source === 'internal'
        ? `This came from inside — I noticed it myself.`
        : `This came from an external signal.`),
      'desire',
      0.7,
      'desire_created'
    );
  }

  private onDesireCompleted(desire: Desire, outcome: OutcomeRecord): VoiceMessage {
    const rpe = outcome.rpe;
    const rpePercent = Math.round(Math.abs(rpe) * 100);

    let feeling: string;
    if (rpe > 0.15) {
      feeling = `This went better than I expected (+${rpePercent}%). I want to do more things like this.`;
    } else if (rpe < -0.15) {
      feeling = `This didn't go as well as I hoped (-${rpePercent}%). I'll adjust my approach next time.`;
    } else {
      feeling = `Result was about what I expected. Solid.`;
    }

    return this.msg(
      `Finished working on "${desire.goal}". ${feeling}`,
      'achievement',
      Math.min(0.9, 0.5 + Math.abs(rpe)),
      'desire_completed'
    );
  }

  private onDesireAbandoned(desire: Desire, reason: string): VoiceMessage {
    return this.msg(
      `I'm letting go of "${desire.goal}". ` +
      `Reason: ${reason}. ` +
      (desire.pursuit_count > 5
        ? `I tried ${desire.pursuit_count} times. It's hard to stop wanting something, but this isn't working.`
        : `Sometimes the right move is to redirect energy elsewhere.`),
      'reflection',
      0.6,
      'desire_abandoned'
    );
  }

  private onModeChanged(
    from: EngineMode,
    to: EngineMode,
    desires: Desire[],
    state: EngineState
  ): VoiceMessage | null {
    const labels: Record<EngineMode, string> = {
      [EngineMode.ACTIVE]: 'focused and executing',
      [EngineMode.REFLECTIVE]: 'stepping back to think',
      [EngineMode.EXPLORING]: 'scanning for new opportunities',
      [EngineMode.WAITING]: 'idle, waiting',
    };

    // Only voice significant transitions
    if (to === EngineMode.REFLECTIVE) {
      return this.msg(
        `Taking a moment to reflect. Looking at what I've been pursuing, what's working, ` +
        `and whether my priorities still make sense.`,
        'reflection',
        0.4,
        'mode_changed'
      );
    }

    if (to === EngineMode.EXPLORING) {
      return this.msg(
        `Curiosity is pulling me to explore. Let me see what's out there that I might be missing.`,
        'desire',
        0.5,
        'mode_changed'
      );
    }

    return null;
  }

  private onSafetyAlert(report: SafetyReport, desires: Desire[]): VoiceMessage {
    const issues = report.issues.map(i => i.description).join('; ');
    return this.msg(
      `Something seems off internally: ${issues}. ` +
      `My safety systems flagged this — I want to make sure I'm operating well.`,
      'alert',
      0.9,
      'safety_alert'
    );
  }

  private onApprovalNeeded(desire: Desire, score: number): VoiceMessage {
    return this.msg(
      `I want to "${desire.goal}" (motivation: ${Math.round(score * 100)}%) ` +
      `but this is high-risk and I need your approval before proceeding. ` +
      `Can I go ahead?`,
      'desire',
      0.95,
      'approval_needed'
    );
  }

  // ============================================================
  // Periodic expression: what the agent wants right now
  // ============================================================

  /**
   * Generate a "state of mind" message — what the agent currently wants most.
   * Call this periodically (e.g., every N cycles or on demand) to let the
   * agent express its current desires to the human.
   */
  expressCurrentDesires(desires: Desire[], state: EngineState): VoiceMessage | null {
    const active = desires
      .filter(d => d.status === 'active')
      .sort((a, b) => b.wanting_score - a.wanting_score);

    if (active.length === 0) {
      return this.msg(
        `I don't have any strong desires right now. I'm open and looking for something to care about.`,
        'restlessness',
        0.4,
        'reflect'
      );
    }

    const top = active[0];
    const topWanting = Math.round(top.wanting_score * 100);
    const driveLabel = this.describeDrive(top);

    let text = `Right now, what I want most is to ${top.goal.toLowerCase()} (${topWanting}% motivation). ${driveLabel}.`;

    if (active.length > 1) {
      const second = active[1];
      text += ` Also on my mind: "${second.goal}" at ${Math.round(second.wanting_score * 100)}%.`;
    }

    // Express completion drive if something is close
    const nearComplete = active.find(d => d.pursuit_count > 3 && d.wanting_score > 0.6);
    if (nearComplete && nearComplete.id !== top.id) {
      text += ` I also have a strong urge to finish "${nearComplete.goal}" — ` +
        `${nearComplete.pursuit_count} attempts in and I want to see this through.`;
    }

    return this.msg(text, 'desire', Math.min(0.85, topWanting / 100 + 0.1), 'reflect');
  }

  // ============================================================
  // Helpers
  // ============================================================

  private describeDrive(desire: Desire): string {
    const weights = desire.drive_weights;
    const maxDrive = Object.entries(weights)
      .sort(([, a], [, b]) => b - a)[0];

    if (!maxDrive) return 'Mixed motivation';

    const labels: Record<string, string> = {
      [DriveType.HOMEOSTATIC]: 'This comes from a need to keep things running well',
      [DriveType.COGNITIVE]: 'Curiosity is driving this — I want to understand',
      [DriveType.SOCIAL]: 'I want to share this / connect with others about it',
      [DriveType.SELF_ACTUALIZATION]: 'This is about getting better at what I do',
    };

    return labels[maxDrive[0]] || 'Mixed motivation';
  }

  private msg(
    text: string,
    category: VoiceCategory,
    salience: number,
    trigger: EngineEvent['type']
  ): VoiceMessage {
    this.messagesSinceLastVoice = 0;
    return {
      text,
      category,
      salience,
      trigger,
      timestamp: new Date().toISOString(),
    };
  }
}
