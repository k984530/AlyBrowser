import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { ChromeNotFoundError } from '../errors';

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
    const found = scanForChromeBinary(chromeDir);
    if (found) return found;
  }

  // 3. Auto-install Chrome for Testing in ~/.aly-browser/chrome
  const globalChromeDir = path.join(os.homedir(), '.aly-browser');
  const installed = autoInstallChromeForTesting(globalChromeDir);
  if (installed) return installed;

  // 4. Fall back to regular Chrome (--load-extension may not work)
  return findChrome();
}

/**
 * Auto-install Chrome for Testing via npx @puppeteer/browsers.
 * Installs once to ~/.aly-browser/chrome and reuses on subsequent calls.
 */
function autoInstallChromeForTesting(baseDir: string): string | null {
  const chromeDir = path.join(baseDir, 'chrome');

  // Check if already installed
  if (fs.existsSync(chromeDir)) {
    const found = scanForChromeBinary(chromeDir);
    if (found) return found;
  }

  // Install
  try {
    fs.mkdirSync(baseDir, { recursive: true });
    execSync(
      `npx @puppeteer/browsers install chrome@stable --path "${baseDir}"`,
      { encoding: 'utf-8', timeout: 120_000, stdio: 'pipe' },
    );
    // Remove macOS quarantine
    if (process.platform === 'darwin') {
      try { execSync(`xattr -c "${chromeDir}"`, { stdio: 'ignore' }); } catch (err) { /* xattr removal optional */ }
    }
    const found = scanForChromeBinary(chromeDir);
    if (found) return found;
  } catch (err) { /* Chrome install failed — fall through to null */ }

  return null;
}

function scanForChromeBinary(chromeDir: string): string | null {
  try {
    for (const entry of fs.readdirSync(chromeDir)) {
      const platform = process.platform;
      let binary: string;
      if (platform === 'darwin') {
        for (const arch of ['chrome-mac-arm64', 'chrome-mac-x64']) {
          binary = path.join(
            chromeDir, entry, arch,
            'Google Chrome for Testing.app', 'Contents', 'MacOS',
            'Google Chrome for Testing',
          );
          if (fs.existsSync(binary)) return binary;
        }
      } else if (platform === 'linux') {
        binary = path.join(chromeDir, entry, 'chrome-linux64', 'chrome');
        if (fs.existsSync(binary)) return binary;
      } else if (platform === 'win32') {
        binary = path.join(chromeDir, entry, 'chrome-win64', 'chrome.exe');
        if (fs.existsSync(binary)) return binary;
      }
    }
  } catch (err) { /* directory scan failed */ }
  return null;
}
