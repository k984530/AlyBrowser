import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { ChromeNotFoundError } from '../cdp/errors';

const MAC_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];

const WIN_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
];

function whichSync(cmd: string): string | undefined {
  try {
    return execSync(`which ${cmd}`, { encoding: 'utf-8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function findChrome(): string {
  const searched: string[] = [];

  // 1. Environment variable
  const envPath = process.env.CHROME_PATH;
  if (envPath) {
    searched.push(envPath);
    if (fs.existsSync(envPath)) return envPath;
  }

  const platform = process.platform;

  // 2. Platform-specific candidates
  if (platform === 'darwin') {
    for (const p of MAC_CANDIDATES) {
      searched.push(p);
      if (fs.existsSync(p)) return p;
    }
  } else if (platform === 'linux') {
    for (const cmd of ['google-chrome', 'chromium-browser', 'chromium']) {
      const resolved = whichSync(cmd);
      searched.push(resolved ?? cmd);
      if (resolved && fs.existsSync(resolved)) return resolved;
    }
  } else if (platform === 'win32') {
    for (const p of WIN_CANDIDATES) {
      searched.push(p);
      if (fs.existsSync(p)) return p;
    }
  }

  throw new ChromeNotFoundError(searched);
}

/**
 * Find Chrome for Testing binary.
 * Searches in local `chrome/` directory (installed via @puppeteer/browsers),
 * then falls back to CHROME_FOR_TESTING_PATH env, then system paths.
 */
export function findChromeForTesting(projectRoot?: string): string {
  // 1. Environment variable
  const envPath = process.env.CHROME_FOR_TESTING_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;

  // 2. Search in local chrome/ directory (npx @puppeteer/browsers install)
  const roots = projectRoot
    ? [projectRoot]
    : [process.cwd(), path.resolve(
        typeof __dirname !== 'undefined'
          ? __dirname
          : path.dirname(fileURLToPath(import.meta.url)),
        '..', '..')];

  for (const root of roots) {
    const chromeDir = path.join(root, 'chrome');
    if (!fs.existsSync(chromeDir)) continue;

    try {
      for (const entry of fs.readdirSync(chromeDir)) {
        const platform = process.platform;
        let binary: string;

        if (platform === 'darwin') {
          binary = path.join(
            chromeDir, entry, 'chrome-mac-arm64',
            'Google Chrome for Testing.app', 'Contents', 'MacOS',
            'Google Chrome for Testing',
          );
          if (fs.existsSync(binary)) return binary;
          // Also check x64
          binary = path.join(
            chromeDir, entry, 'chrome-mac-x64',
            'Google Chrome for Testing.app', 'Contents', 'MacOS',
            'Google Chrome for Testing',
          );
          if (fs.existsSync(binary)) return binary;
        } else if (platform === 'linux') {
          binary = path.join(chromeDir, entry, 'chrome-linux64', 'chrome');
          if (fs.existsSync(binary)) return binary;
        } else if (platform === 'win32') {
          binary = path.join(chromeDir, entry, 'chrome-win64', 'chrome.exe');
          if (fs.existsSync(binary)) return binary;
        }
      }
    } catch {}
  }

  // 3. Fall back to regular Chrome
  return findChrome();
}
