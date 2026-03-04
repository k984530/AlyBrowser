import { CDPSession } from './cdp/session';
import { RefRegistry } from './extractors/ref-registry';
import { buildSnapshot } from './extractors/snapshot';
import { goto, reload, goBack, goForward } from './actions/navigate';
import { evaluate, evaluateHandle, callFunction } from './actions/evaluate';
import { waitForSelector, waitForFunction, waitForNavigation } from './actions/wait';
import { click, type as typeAction, selectOption, hover, focus } from './actions/interact';
import { scrollTo, scrollBy, scrollIntoView } from './actions/scroll';
import { ElementNotFoundError } from './cdp/errors';
import type {
  Snapshot,
  GotoOptions,
  WaitOptions,
  ClickOptions,
  TypeOptions,
  ScrollOptions,
} from './types';

export class AlyPage {
  private readonly session: CDPSession;
  private readonly registry = new RefRegistry();
  readonly targetId: string;

  constructor(session: CDPSession, targetId: string) {
    this.session = session;
    this.targetId = targetId;
  }

  private send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.session.send(method, params);
  }

  // ── Navigation ──────────────────────────────────────────────────────

  async goto(url: string, options?: GotoOptions): Promise<void> {
    await goto(this.send.bind(this), url, options);
  }

  async reload(): Promise<void> {
    await reload(this.send.bind(this));
  }

  async goBack(): Promise<void> {
    await goBack(this.send.bind(this));
  }

  async goForward(): Promise<void> {
    await goForward(this.send.bind(this));
  }

  // ── Content Extraction ──────────────────────────────────────────────

  async snapshot(): Promise<Snapshot> {
    await this.session.enableDomain('Accessibility');
    return buildSnapshot(this.send.bind(this), this.registry);
  }

  async title(): Promise<string> {
    return evaluate<string>(this.send.bind(this), 'document.title');
  }

  async url(): Promise<string> {
    return evaluate<string>(this.send.bind(this), 'location.href');
  }

  async content(): Promise<string> {
    return evaluate<string>(
      this.send.bind(this),
      'document.documentElement.outerHTML',
    );
  }

  // ── Element Actions (ref-based) ─────────────────────────────────────

  async click(ref: string, options?: ClickOptions): Promise<void> {
    const backendNodeId = this.resolveRef(ref);
    await click(this.send.bind(this), backendNodeId, options);
  }

  async type(ref: string, text: string, options?: TypeOptions): Promise<void> {
    const backendNodeId = this.resolveRef(ref);
    await typeAction(this.send.bind(this), backendNodeId, text, options);
  }

  async selectOption(ref: string, values: string | string[]): Promise<void> {
    const backendNodeId = this.resolveRef(ref);
    await selectOption(this.send.bind(this), backendNodeId, values);
  }

  async hover(ref: string): Promise<void> {
    const backendNodeId = this.resolveRef(ref);
    await hover(this.send.bind(this), backendNodeId);
  }

  async focus(ref: string): Promise<void> {
    const backendNodeId = this.resolveRef(ref);
    await focus(this.send.bind(this), backendNodeId);
  }

  async scrollIntoView(ref: string): Promise<void> {
    const backendNodeId = this.resolveRef(ref);
    await scrollIntoView(this.send.bind(this), backendNodeId);
  }

  // ── Scroll ──────────────────────────────────────────────────────────

  async scrollTo(options: ScrollOptions): Promise<void> {
    await scrollTo(this.send.bind(this), options);
  }

  async scrollBy(options: ScrollOptions): Promise<void> {
    await scrollBy(this.send.bind(this), options);
  }

  // ── JavaScript Evaluation ───────────────────────────────────────────

  async evaluate<T = unknown>(expression: string): Promise<T> {
    return evaluate<T>(this.send.bind(this), expression);
  }

  async evaluateHandle(expression: string): Promise<string> {
    return evaluateHandle(this.send.bind(this), expression);
  }

  // ── Waiting ─────────────────────────────────────────────────────────

  async waitForSelector(selector: string, options?: WaitOptions): Promise<void> {
    await waitForSelector(this.send.bind(this), selector, options);
  }

  async waitForFunction(expression: string, options?: WaitOptions): Promise<void> {
    await waitForFunction(this.send.bind(this), expression, options);
  }

  async waitForNavigation(options?: { timeout?: number }): Promise<void> {
    await waitForNavigation(this.send.bind(this), options);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  async close(): Promise<void> {
    this.session.dispose();
  }

  // ── Internal ────────────────────────────────────────────────────────

  private resolveRef(ref: string): number {
    if (!ref.startsWith('@e')) {
      throw new ElementNotFoundError(ref);
    }
    return this.registry.resolveRef(ref);
  }
}
