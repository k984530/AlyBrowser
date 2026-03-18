import { describe, it, expect } from 'vitest';
import { WorkflowRunner } from '../../src/mcp/workflow-runner';
import type { Recording } from '../../src/mcp/action-recorder';

const validRecording: Recording = {
  id: 'rec-1',
  name: 'Login Flow',
  url: 'https://example.com/login',
  actions: [
    { action: 'navigate', target: 'https://example.com/login', timestamp: 0 },
    { action: 'type', target: '@e1', value: 'user@test.com', timestamp: 1 },
    { action: 'type', target: '@e2', value: 'password', timestamp: 2 },
    { action: 'click', target: '@e3', timestamp: 3 },
    { action: 'wait', target: '.dashboard', timestamp: 4 },
    { action: 'snapshot', timestamp: 5 },
  ],
  startedAt: Date.now(),
};

describe('WorkflowRunner', () => {
  describe('validate', () => {
    it('validates correct recording', () => {
      const wr = new WorkflowRunner();
      const result = wr.validate(validRecording);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('catches empty actions', () => {
      const wr = new WorkflowRunner();
      const result = wr.validate({ ...validRecording, actions: [] });
      expect(result.valid).toBe(false);
      expect(result.issues[0]).toContain('No actions');
    });

    it('catches missing URL', () => {
      const wr = new WorkflowRunner();
      const result = wr.validate({ ...validRecording, url: '' });
      expect(result.valid).toBe(false);
      expect(result.issues[0]).toContain('Missing start URL');
    });

    it('catches click without target', () => {
      const wr = new WorkflowRunner();
      const result = wr.validate({
        ...validRecording,
        actions: [{ action: 'click', timestamp: 0 }],
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]).toContain('click requires target');
    });

    it('catches type without value', () => {
      const wr = new WorkflowRunner();
      const result = wr.validate({
        ...validRecording,
        actions: [{ action: 'type', target: '@e0', timestamp: 0 }],
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]).toContain('type requires target and value');
    });

    it('catches invalid action type', () => {
      const wr = new WorkflowRunner();
      const result = wr.validate({
        ...validRecording,
        actions: [{ action: 'destroy' as any, timestamp: 0 }],
      });
      expect(result.valid).toBe(false);
      expect(result.issues[0]).toContain('invalid action');
    });
  });

  describe('plan', () => {
    it('generates readable plan', () => {
      const wr = new WorkflowRunner();
      const plan = wr.plan(validRecording);
      expect(plan).toContain('Login Flow');
      expect(plan).toContain('navigate');
      expect(plan).toContain('type');
      expect(plan).toContain('click');
      expect(plan).toContain('Steps: 6');
    });
  });

  describe('estimate', () => {
    it('estimates based on step count and delay', () => {
      const wr = new WorkflowRunner({ stepDelay: 1000 });
      expect(wr.estimate(validRecording)).toBe(6000);
    });

    it('uses default 500ms delay', () => {
      const wr = new WorkflowRunner();
      expect(wr.estimate(validRecording)).toBe(3000);
    });
  });

  describe('stepDelay', () => {
    it('gets and sets delay', () => {
      const wr = new WorkflowRunner();
      expect(wr.getStepDelay()).toBe(500);
      wr.setStepDelay(200);
      expect(wr.getStepDelay()).toBe(200);
    });

    it('clamps negative to 0', () => {
      const wr = new WorkflowRunner();
      wr.setStepDelay(-100);
      expect(wr.getStepDelay()).toBe(0);
    });
  });
});
