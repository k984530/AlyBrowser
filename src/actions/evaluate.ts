type SendCommand = (method: string, params?: any) => Promise<any>;

// ── Public API ──────────────────────────────────────────────────────

export async function evaluate<T = unknown>(
  sendCommand: SendCommand,
  expression: string,
): Promise<T> {
  const response = await sendCommand('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });

  if (response?.exceptionDetails) {
    const details = response.exceptionDetails;
    const message =
      details.exception?.description ?? details.text ?? 'Evaluation failed';
    throw new Error(message);
  }

  return response?.result?.value as T;
}

export async function evaluateHandle(
  sendCommand: SendCommand,
  expression: string,
): Promise<string> {
  const response = await sendCommand('Runtime.evaluate', {
    expression,
    returnByValue: false,
    awaitPromise: true,
  });

  if (response?.exceptionDetails) {
    const details = response.exceptionDetails;
    const message =
      details.exception?.description ?? details.text ?? 'Evaluation failed';
    throw new Error(message);
  }

  return response?.result?.objectId as string;
}

export async function callFunction(
  sendCommand: SendCommand,
  objectId: string,
  functionDeclaration: string,
  args?: Array<{ value?: unknown; objectId?: string }>,
): Promise<any> {
  const response = await sendCommand('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration,
    arguments: args ?? [],
    returnByValue: true,
    awaitPromise: true,
  });

  if (response?.exceptionDetails) {
    const details = response.exceptionDetails;
    const message =
      details.exception?.description ?? details.text ?? 'callFunctionOn failed';
    throw new Error(message);
  }

  return response?.result?.value;
}
