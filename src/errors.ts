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

export class ChromeNotFoundError extends AlyBrowserError {
  constructor(searched: string[]) {
    super(
      `Chrome executable not found. Searched: ${searched.join(', ')}`,
      'Set CHROME_PATH environment variable or install Google Chrome.',
    );
    this.name = 'ChromeNotFoundError';
  }
}
