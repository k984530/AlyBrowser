import { EventEmitter } from 'events';
import { CDPTransport } from './transport';
import { CDPTimeoutError, CDPProtocolError } from './errors';
import { Deferred } from '../utils/deferred';
import { Logger } from '../utils/logger';
import type { CDPSendOptions, CDPResponse, CDPEvent } from '../types';

const DEFAULT_TIMEOUT = 30_000;

export class CDPClient extends EventEmitter {
  private nextId = 1;
  private callbacks = new Map<number, { deferred: Deferred<unknown>; method: string; timer: ReturnType<typeof setTimeout> }>();
  private readonly transport: CDPTransport;
  private readonly log = new Logger('cdp');

  constructor(transport: CDPTransport) {
    super();
    this.transport = transport;

    this.transport.on('message', (raw: string) => {
      this.onMessage(raw);
    });

    this.transport.on('close', () => {
      this.rejectAllPending('Connection closed');
      this.emit('close');
    });
  }

  send(method: string, params?: Record<string, unknown>, options?: CDPSendOptions): Promise<unknown> {
    const id = this.nextId++;
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;

    const message: Record<string, unknown> = { id, method };
    if (params) message.params = params;
    if (options?.sessionId) message.sessionId = options.sessionId;

    const deferred = new Deferred<unknown>();

    const timer = setTimeout(() => {
      this.callbacks.delete(id);
      deferred.reject(new CDPTimeoutError(method, timeout));
    }, timeout);

    this.callbacks.set(id, { deferred, method, timer });

    this.log.debug('>>>', method, id);
    this.transport.send(JSON.stringify(message));

    return deferred.promise;
  }

  on(event: string, callback: (...args: any[]) => void): this {
    return super.on(event, callback);
  }

  close(): void {
    this.rejectAllPending('Client closed');
    this.transport.close();
  }

  private onMessage(raw: string): void {
    let parsed: CDPResponse | CDPEvent;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.log.warn('failed to parse CDP message', raw.slice(0, 200));
      return;
    }

    // Response to a command
    if ('id' in parsed && typeof (parsed as CDPResponse).id === 'number') {
      const resp = parsed as CDPResponse;
      const entry = this.callbacks.get(resp.id);
      if (!entry) return;

      clearTimeout(entry.timer);
      this.callbacks.delete(resp.id);

      if (resp.error) {
        entry.deferred.reject(
          new CDPProtocolError(entry.method, resp.error.code, resp.error.message),
        );
      } else {
        entry.deferred.resolve(resp.result ?? {});
      }
      return;
    }

    // Event
    if ('method' in parsed) {
      const evt = parsed as CDPEvent;
      this.log.debug('evt', evt.method, evt.sessionId ?? '');
      this.emit(evt.method, evt.params, evt.sessionId);
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, entry] of this.callbacks) {
      clearTimeout(entry.timer);
      entry.deferred.reject(new Error(`${reason} (pending: ${entry.method}, id: ${id})`));
    }
    this.callbacks.clear();
  }
}
