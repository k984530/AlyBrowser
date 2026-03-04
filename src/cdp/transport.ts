import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { Deferred } from '../utils/deferred';
import { Logger } from '../utils/logger';
import { CDPConnectionError } from './errors';

export class CDPTransport extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly log = new Logger('transport');

  async connect(url: string): Promise<void> {
    const ready = new Deferred<void>();

    const ws = new WebSocket(url);

    ws.on('open', () => {
      this.log.debug('connected to', url);
      ready.resolve();
    });

    ws.on('message', (data: WebSocket.Data) => {
      const message = data.toString();
      this.log.debug('recv', message.slice(0, 200));
      this.emit('message', message);
    });

    ws.on('close', () => {
      this.log.debug('connection closed');
      this.emit('close');
      this.ws = null;
    });

    ws.on('error', (err: Error) => {
      this.log.error('ws error', err.message);
      this.emit('error', err);
      ready.reject(new CDPConnectionError(url, err.message));
    });

    this.ws = ws;
    return ready.promise;
  }

  send(data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new CDPConnectionError('', 'WebSocket is not open');
    }
    this.log.debug('send', data.slice(0, 200));
    this.ws.send(data);
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
