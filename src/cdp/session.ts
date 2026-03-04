import { CDPClient } from './client';
import { Logger } from '../utils/logger';

type EventCallback = (params: Record<string, unknown>) => void;

export class CDPSession {
  private readonly client: CDPClient;
  private readonly sessionId: string;
  private readonly log: Logger;
  private readonly enabledDomains = new Set<string>();
  private readonly listeners: Array<{ event: string; wrapper: (...args: unknown[]) => void }> = [];

  constructor(client: CDPClient, sessionId: string) {
    this.client = client;
    this.sessionId = sessionId;
    this.log = new Logger(`session:${sessionId.slice(0, 8)}`);
  }

  send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.client.send(method, params, { sessionId: this.sessionId });
  }

  on(event: string, callback: EventCallback): this {
    const wrapper = (params: Record<string, unknown>, sessionId?: string) => {
      if (sessionId === this.sessionId) {
        callback(params);
      }
    };
    this.client.on(event, wrapper as (...args: unknown[]) => void);
    this.listeners.push({ event, wrapper: wrapper as (...args: unknown[]) => void });
    return this;
  }

  async enableDomain(domain: string): Promise<void> {
    if (this.enabledDomains.has(domain)) {
      this.log.debug('domain already enabled:', domain);
      return;
    }
    await this.send(`${domain}.enable`);
    this.enabledDomains.add(domain);
    this.log.debug('domain enabled:', domain);
  }

  dispose(): void {
    for (const { event, wrapper } of this.listeners) {
      this.client.removeListener(event, wrapper);
    }
    this.listeners.length = 0;
    this.enabledDomains.clear();
    this.log.debug('disposed');
  }
}
