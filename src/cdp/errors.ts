export class AlyBrowserError extends Error {
  readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'AlyBrowserError';
    this.hint = hint;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      hint: this.hint,
      stack: this.stack,
    };
  }
}

// ── Chrome Errors ────────────────────────────────────────────────────

export class ChromeNotFoundError extends AlyBrowserError {
  constructor(searched: string[]) {
    super(
      `Chrome executable not found. Searched: ${searched.join(', ')}`,
      'Set CHROME_PATH environment variable or install Google Chrome.',
    );
    this.name = 'ChromeNotFoundError';
  }
}

export class ChromeLaunchError extends AlyBrowserError {
  constructor(reason: string) {
    super(
      `Failed to launch Chrome: ${reason}`,
      'Check if another Chrome instance is using the same user data directory.',
    );
    this.name = 'ChromeLaunchError';
  }
}

export class ChromeCrashedError extends AlyBrowserError {
  constructor() {
    super(
      'Chrome process crashed unexpectedly.',
      'Relaunch with AlyBrowser.launch().',
    );
    this.name = 'ChromeCrashedError';
  }
}

// ── CDP Errors ───────────────────────────────────────────────────────

export class CDPConnectionError extends AlyBrowserError {
  constructor(url: string, cause?: string) {
    super(
      `Failed to connect to CDP endpoint: ${url}${cause ? ` (${cause})` : ''}`,
      'Ensure Chrome is running with --remote-debugging-port.',
    );
    this.name = 'CDPConnectionError';
  }
}

export class CDPTimeoutError extends AlyBrowserError {
  constructor(method: string, timeoutMs: number) {
    super(
      `CDP command "${method}" timed out after ${timeoutMs}ms.`,
      'Increase timeout or check if the page is responsive.',
    );
    this.name = 'CDPTimeoutError';
  }
}

export class CDPProtocolError extends AlyBrowserError {
  readonly code: number;

  constructor(method: string, code: number, message: string) {
    super(
      `CDP protocol error in "${method}": ${message} (code ${code})`,
    );
    this.name = 'CDPProtocolError';
    this.code = code;
  }
}

// ── Navigation Errors ────────────────────────────────────────────────

export class NavigationTimeoutError extends AlyBrowserError {
  constructor(url: string, timeoutMs: number) {
    super(
      `Navigation to "${url}" timed out after ${timeoutMs}ms.`,
      'Increase timeout or check network connectivity.',
    );
    this.name = 'NavigationTimeoutError';
  }
}

export class NavigationFailedError extends AlyBrowserError {
  constructor(url: string, reason: string) {
    super(
      `Navigation to "${url}" failed: ${reason}`,
    );
    this.name = 'NavigationFailedError';
  }
}

// ── Element Errors ───────────────────────────────────────────────────

export class ElementNotFoundError extends AlyBrowserError {
  constructor(ref: string) {
    super(
      `Element "${ref}" not found.`,
      'Call snapshot() to refresh element references.',
    );
    this.name = 'ElementNotFoundError';
  }
}

export class ElementStaleError extends AlyBrowserError {
  constructor(ref: string) {
    super(
      `Element "${ref}" is stale (page may have changed).`,
      'Call snapshot() to get fresh references.',
    );
    this.name = 'ElementStaleError';
  }
}

export class ElementNotInteractableError extends AlyBrowserError {
  constructor(ref: string, reason: string) {
    super(
      `Element "${ref}" is not interactable: ${reason}`,
      'Ensure the element is visible and not disabled.',
    );
    this.name = 'ElementNotInteractableError';
  }
}
