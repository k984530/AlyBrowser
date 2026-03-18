/**
 * Action Recorder — records browser actions and generates replayable sequences.
 * Captures navigation, clicks, types, and waits as a JSON script.
 */

export interface RecordedAction {
  action: 'navigate' | 'click' | 'type' | 'select' | 'scroll' | 'wait' | 'snapshot';
  target?: string;  // URL, ref, or selector
  value?: string;   // text for type, value for select
  timestamp: number;
}

export interface Recording {
  id: string;
  name: string;
  url: string;
  actions: RecordedAction[];
  startedAt: number;
  stoppedAt?: number;
}

export class ActionRecorder {
  private recordings = new Map<string, Recording>();
  private activeRecording: string | null = null;
  private nextId = 1;

  /** Start recording actions */
  start(name: string, url: string): Recording {
    const id = `rec-${this.nextId++}`;
    const recording: Recording = {
      id, name, url,
      actions: [{ action: 'navigate', target: url, timestamp: Date.now() }],
      startedAt: Date.now(),
    };
    this.recordings.set(id, recording);
    this.activeRecording = id;
    return recording;
  }

  /** Stop recording */
  stop(): Recording | null {
    if (!this.activeRecording) return null;
    const rec = this.recordings.get(this.activeRecording);
    if (rec) rec.stoppedAt = Date.now();
    this.activeRecording = null;
    return rec || null;
  }

  /** Record an action */
  record(action: RecordedAction['action'], target?: string, value?: string): void {
    if (!this.activeRecording) return;
    const rec = this.recordings.get(this.activeRecording);
    if (!rec) return;
    rec.actions.push({ action, target, value, timestamp: Date.now() });
  }

  /** Check if recording is active */
  isRecording(): boolean {
    return this.activeRecording !== null;
  }

  /** Get active recording ID */
  getActiveId(): string | null {
    return this.activeRecording;
  }

  /** Get a recording by ID */
  get(id: string): Recording | undefined {
    return this.recordings.get(id);
  }

  /** List all recordings */
  list(): Recording[] {
    return Array.from(this.recordings.values());
  }

  /** Delete a recording */
  delete(id: string): boolean {
    if (this.activeRecording === id) this.activeRecording = null;
    return this.recordings.delete(id);
  }

  /** Export recording as JSON */
  export(id: string): string | null {
    const rec = this.recordings.get(id);
    return rec ? JSON.stringify(rec, null, 2) : null;
  }

  /** Import recording from JSON */
  import(json: string): Recording {
    const rec = JSON.parse(json) as Recording;
    if (!rec.id) rec.id = `rec-${this.nextId++}`;
    this.recordings.set(rec.id, rec);
    return rec;
  }
}
