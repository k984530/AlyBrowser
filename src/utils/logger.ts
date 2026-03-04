export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export class Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(prefix: string, level?: LogLevel) {
    this.prefix = prefix;
    this.level = level ?? (process.env.ALY_DEBUG ? 'debug' : 'silent');
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  debug(...args: unknown[]) {
    if (this.shouldLog('debug')) {
      process.stderr.write(`[aly:${this.prefix}] ${args.map(String).join(' ')}\n`);
    }
  }

  info(...args: unknown[]) {
    if (this.shouldLog('info')) {
      process.stderr.write(`[aly:${this.prefix}] ${args.map(String).join(' ')}\n`);
    }
  }

  warn(...args: unknown[]) {
    if (this.shouldLog('warn')) {
      process.stderr.write(`[aly:${this.prefix}] WARN ${args.map(String).join(' ')}\n`);
    }
  }

  error(...args: unknown[]) {
    if (this.shouldLog('error')) {
      process.stderr.write(`[aly:${this.prefix}] ERROR ${args.map(String).join(' ')}\n`);
    }
  }
}
