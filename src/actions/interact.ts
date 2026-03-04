import type { ClickOptions, TypeOptions } from '../types/index';

type SendCommand = (method: string, params?: any) => Promise<any>;

// ── Helpers ─────────────────────────────────────────────────────────

async function getCenter(
  sendCommand: SendCommand,
  backendNodeId: number,
): Promise<{ x: number; y: number }> {
  await sendCommand('DOM.scrollIntoViewIfNeeded', { backendNodeId });
  const box = await sendCommand('DOM.getBoxModel', { backendNodeId });
  const content: number[] = box.model.content;
  // content = [x1,y1, x2,y2, x3,y3, x4,y4]
  const x = (content[0] + content[4]) / 2;
  const y = (content[1] + content[5]) / 2;
  return { x, y };
}

async function resolveNode(
  sendCommand: SendCommand,
  backendNodeId: number,
): Promise<string> {
  const result = await sendCommand('DOM.resolveNode', { backendNodeId });
  return result.object.objectId as string;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Public API ──────────────────────────────────────────────────────

export async function click(
  sendCommand: SendCommand,
  backendNodeId: number,
  options?: ClickOptions,
): Promise<void> {
  const button = options?.button ?? 'left';
  const clickCount = options?.clickCount ?? 1;

  try {
    const { x, y } = await getCenter(sendCommand, backendNodeId);

    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button,
      clickCount,
    });

    if (options?.delay) {
      await delay(options.delay);
    }

    await sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button,
      clickCount,
    });
  } catch {
    // Fallback: use DOM click via JS
    const objectId = await resolveNode(sendCommand, backendNodeId);
    await sendCommand('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: 'function() { this.click(); }',
    });
  }
}

export async function type(
  sendCommand: SendCommand,
  backendNodeId: number,
  text: string,
  options?: TypeOptions,
): Promise<void> {
  const objectId = await resolveNode(sendCommand, backendNodeId);

  // Focus the element
  await sendCommand('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: 'function() { this.focus(); }',
  });

  // Clear existing content if requested
  if (options?.clear) {
    // Ctrl+A to select all
    await sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'a',
      modifiers: 2, // Ctrl
    });
    await sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      modifiers: 2,
    });
    // Backspace to delete selection
    await sendCommand('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Backspace',
    });
    await sendCommand('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Backspace',
    });
  }

  if (options?.delay) {
    // Type character by character with delay
    for (const char of text) {
      await sendCommand('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: char,
        text: char,
      });
      await sendCommand('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: char,
      });
      await delay(options.delay);
    }
  } else {
    // Insert all at once
    await sendCommand('Input.insertText', { text });
  }
}

export async function selectOption(
  sendCommand: SendCommand,
  backendNodeId: number,
  values: string | string[],
): Promise<void> {
  const objectId = await resolveNode(sendCommand, backendNodeId);
  const valArray = Array.isArray(values) ? values : [values];

  await sendCommand('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: `function(values) {
      const vals = JSON.parse(values);
      for (const option of this.options) {
        option.selected = vals.includes(option.value);
      }
      this.dispatchEvent(new Event('input', { bubbles: true }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
    }`,
    arguments: [{ value: JSON.stringify(valArray) }],
  });
}

export async function hover(
  sendCommand: SendCommand,
  backendNodeId: number,
): Promise<void> {
  const { x, y } = await getCenter(sendCommand, backendNodeId);

  await sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
  });
}

export async function focus(
  sendCommand: SendCommand,
  backendNodeId: number,
): Promise<void> {
  const objectId = await resolveNode(sendCommand, backendNodeId);
  await sendCommand('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: 'function() { this.focus(); }',
  });
}
