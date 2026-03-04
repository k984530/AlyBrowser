import type { GotoOptions } from '../types/index';
import { NavigationFailedError, NavigationTimeoutError } from '../cdp/errors';

// ── Helpers ─────────────────────────────────────────────────────────

type SendCommand = (method: string, params?: any) => Promise<any>;

const DEFAULT_TIMEOUT = 30_000;
const POLL_INTERVAL = 100;

async function waitForReadyState(
  sendCommand: SendCommand,
  target: 'complete' | 'interactive',
  timeout: number,
  url: string,
): Promise<void> {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const result = await sendCommand('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    });

    const state: string = result?.result?.value;

    if (target === 'interactive' && (state === 'interactive' || state === 'complete')) {
      return;
    }
    if (target === 'complete' && state === 'complete') {
      return;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  throw new NavigationTimeoutError(url, timeout);
}

// ── Public API ──────────────────────────────────────────────────────

export async function goto(
  sendCommand: SendCommand,
  url: string,
  options?: GotoOptions,
): Promise<void> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const waitUntil = options?.waitUntil ?? 'load';

  const response = await sendCommand('Page.navigate', { url });

  if (response?.errorText) {
    throw new NavigationFailedError(url, response.errorText);
  }

  const target = waitUntil === 'domcontentloaded' ? 'interactive' : 'complete';
  await waitForReadyState(sendCommand, target, timeout, url);
}

export async function reload(sendCommand: SendCommand): Promise<void> {
  await sendCommand('Page.reload');
}

export async function goBack(sendCommand: SendCommand): Promise<void> {
  await sendCommand('Runtime.evaluate', {
    expression: 'history.back()',
    awaitPromise: false,
  });
}

export async function goForward(sendCommand: SendCommand): Promise<void> {
  await sendCommand('Runtime.evaluate', {
    expression: 'history.forward()',
    awaitPromise: false,
  });
}
