import type { WaitOptions } from '../types/index';
import { CDPTimeoutError } from '../cdp/errors';

type SendCommand = (method: string, params?: any) => Promise<any>;

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_POLLING = 100;

// ── Public API ──────────────────────────────────────────────────────

export async function waitForSelector(
  sendCommand: SendCommand,
  selector: string,
  options?: WaitOptions,
): Promise<void> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const polling = options?.polling ?? DEFAULT_POLLING;
  const deadline = Date.now() + timeout;

  // Escape single quotes in selector for safe embedding
  const escaped = selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  while (Date.now() < deadline) {
    const response = await sendCommand('Runtime.evaluate', {
      expression: `document.querySelector('${escaped}') !== null`,
      returnByValue: true,
    });

    if (response?.result?.value === true) {
      return;
    }

    await new Promise((r) => setTimeout(r, polling));
  }

  throw new CDPTimeoutError('waitForSelector', timeout);
}

export async function waitForFunction(
  sendCommand: SendCommand,
  expression: string,
  options?: WaitOptions,
): Promise<void> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const polling = options?.polling ?? DEFAULT_POLLING;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const response = await sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (response?.result?.value) {
      return;
    }

    await new Promise((r) => setTimeout(r, polling));
  }

  throw new CDPTimeoutError('waitForFunction', timeout);
}

export async function waitForNavigation(
  sendCommand: SendCommand,
  options?: { timeout?: number },
): Promise<void> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const response = await sendCommand('Runtime.evaluate', {
      expression: "document.readyState === 'complete'",
      returnByValue: true,
    });

    if (response?.result?.value === true) {
      return;
    }

    await new Promise((r) => setTimeout(r, DEFAULT_POLLING));
  }

  throw new CDPTimeoutError('waitForNavigation', timeout);
}
