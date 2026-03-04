import type { ScrollOptions } from '../types/index';

type SendCommand = (method: string, params?: any) => Promise<any>;

// ── Public API ──────────────────────────────────────────────────────

export async function scrollTo(
  sendCommand: SendCommand,
  options: ScrollOptions,
): Promise<void> {
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  const behavior = options.behavior ?? 'instant';

  await sendCommand('Runtime.evaluate', {
    expression: `window.scrollTo({ left: ${x}, top: ${y}, behavior: '${behavior}' })`,
    returnByValue: true,
  });
}

export async function scrollBy(
  sendCommand: SendCommand,
  options: ScrollOptions,
): Promise<void> {
  const x = options.x ?? 0;
  const y = options.y ?? 0;
  const behavior = options.behavior ?? 'instant';

  await sendCommand('Runtime.evaluate', {
    expression: `window.scrollBy({ left: ${x}, top: ${y}, behavior: '${behavior}' })`,
    returnByValue: true,
  });
}

export async function scrollIntoView(
  sendCommand: SendCommand,
  backendNodeId: number,
): Promise<void> {
  await sendCommand('DOM.scrollIntoViewIfNeeded', { backendNodeId });
}
