/**
 * Workflow Runner — executes recorded action sequences (from ActionRecorder).
 * Provides step-by-step execution with status reporting.
 */
import type { Recording, RecordedAction } from './action-recorder';

export interface StepResult {
  index: number;
  action: string;
  target?: string;
  status: 'success' | 'error' | 'skipped';
  error?: string;
  elapsed: number;
}

export interface WorkflowResult {
  recordingId: string;
  name: string;
  totalSteps: number;
  completed: number;
  failed: number;
  skipped: number;
  totalElapsed: number;
  steps: StepResult[];
}

export class WorkflowRunner {
  private stepDelay: number;

  constructor(options?: { stepDelay?: number }) {
    this.stepDelay = options?.stepDelay ?? 500;
  }

  /** Dry-run: validate a recording without executing */
  validate(recording: Recording): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    if (!recording.actions.length) issues.push('No actions in recording');
    if (!recording.url) issues.push('Missing start URL');

    const validActions = new Set(['navigate', 'click', 'type', 'select', 'scroll', 'wait', 'snapshot']);
    for (let i = 0; i < recording.actions.length; i++) {
      const a = recording.actions[i];
      if (!validActions.has(a.action)) {
        issues.push(`Step ${i}: invalid action "${a.action}"`);
      }
      if (a.action === 'click' && !a.target) {
        issues.push(`Step ${i}: click requires target`);
      }
      if (a.action === 'type' && (!a.target || !a.value)) {
        issues.push(`Step ${i}: type requires target and value`);
      }
      if (a.action === 'navigate' && !a.target) {
        issues.push(`Step ${i}: navigate requires URL`);
      }
    }

    return { valid: issues.length === 0, issues };
  }

  /** Generate a human-readable plan from a recording */
  plan(recording: Recording): string {
    const lines = [`Workflow: "${recording.name}"`, `URL: ${recording.url}`, `Steps: ${recording.actions.length}`, ''];

    for (let i = 0; i < recording.actions.length; i++) {
      const a = recording.actions[i];
      const target = a.target ? ` → ${a.target}` : '';
      const value = a.value ? ` "${a.value}"` : '';
      lines.push(`  ${i + 1}. ${a.action}${target}${value}`);
    }

    return lines.join('\n');
  }

  /** Estimate execution time based on step count and delay */
  estimate(recording: Recording): number {
    return recording.actions.length * this.stepDelay;
  }

  /** Get step delay setting */
  getStepDelay(): number {
    return this.stepDelay;
  }

  /** Set step delay */
  setStepDelay(ms: number): void {
    this.stepDelay = Math.max(0, ms);
  }
}
