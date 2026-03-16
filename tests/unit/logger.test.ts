import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '../../src/utils/logger';

describe('Logger', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('suppresses output at silent level (default)', () => {
    const log = new Logger('test', 'silent');
    log.debug('hidden');
    log.info('hidden');
    log.warn('hidden');
    log.error('hidden');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('outputs debug at debug level', () => {
    const log = new Logger('test', 'debug');
    log.debug('hello');
    expect(writeSpy).toHaveBeenCalledWith('[aly:test] hello\n');
  });

  it('outputs warn with WARN prefix', () => {
    const log = new Logger('test', 'warn');
    log.warn('caution');
    expect(writeSpy).toHaveBeenCalledWith('[aly:test] WARN caution\n');
  });

  it('outputs error with ERROR prefix', () => {
    const log = new Logger('test', 'error');
    log.error('broken');
    expect(writeSpy).toHaveBeenCalledWith('[aly:test] ERROR broken\n');
  });

  it('respects level hierarchy (warn level skips debug/info)', () => {
    const log = new Logger('test', 'warn');
    log.debug('skip');
    log.info('skip');
    expect(writeSpy).not.toHaveBeenCalled();
    log.warn('show');
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it('joins multiple arguments with spaces', () => {
    const log = new Logger('test', 'info');
    log.info('a', 'b', 'c');
    expect(writeSpy).toHaveBeenCalledWith('[aly:test] a b c\n');
  });
});
