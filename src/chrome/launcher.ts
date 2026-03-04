import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { findChrome } from './finder';
import { getDefaultFlags } from './flags';
import { ChromeLaunchError } from '../cdp/errors';
import { Deferred } from '../utils/deferred';
import { Logger } from '../utils/logger';
import type { LaunchOptions } from '../types';

const log = new Logger('launcher');

export interface ChromeProcess {
  process: ChildProcess;
  wsEndpoint: string;
  userDataDir: string;
  kill: () => Promise<void>;
}

export async function launchChrome(options?: LaunchOptions): Promise<ChromeProcess> {
  const chromePath = options?.executablePath ?? findChrome();
  const userDataDir = options?.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'aly-'));
  const isTempDir = !options?.userDataDir;
  const timeoutMs = options?.timeout ?? 30_000;

  const flags = [
    ...getDefaultFlags({ headless: options?.headless ?? true }),
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    ...(options?.args ?? []),
  ];

  log.debug('Launching', chromePath, flags.join(' '));

  const chromeProc = spawn(chromePath, flags, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const wsDeferred = new Deferred<string>();

  const stderrChunks: string[] = [];
  chromeProc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    stderrChunks.push(text);
    log.debug('stderr:', text);

    const match = text.match(/DevTools listening on (ws:\/\/\S+)/);
    if (match) {
      wsDeferred.resolve(match[1]);
    }
  });

  chromeProc.on('error', (err) => {
    wsDeferred.reject(new ChromeLaunchError(err.message));
  });

  chromeProc.on('exit', (code, signal) => {
    wsDeferred.reject(
      new ChromeLaunchError(
        `Process exited with code ${code}, signal ${signal}. stderr: ${stderrChunks.join('')}`,
      ),
    );
  });

  const timer = setTimeout(() => {
    wsDeferred.reject(new ChromeLaunchError(`Timed out after ${timeoutMs}ms waiting for DevTools`));
    chromeProc.kill('SIGKILL');
  }, timeoutMs);

  let wsEndpoint: string;
  try {
    wsEndpoint = await wsDeferred.promise;
  } finally {
    clearTimeout(timer);
  }

  log.debug('DevTools endpoint:', wsEndpoint);

  const kill = async (): Promise<void> => {
    if (!chromeProc.killed) {
      chromeProc.kill('SIGTERM');

      await new Promise<void>((resolve) => {
        chromeProc.on('exit', () => resolve());
        setTimeout(() => {
          if (!chromeProc.killed) chromeProc.kill('SIGKILL');
          resolve();
        }, 5_000);
      });
    }

    if (isTempDir) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  };

  return { process: chromeProc, wsEndpoint, userDataDir, kill };
}
