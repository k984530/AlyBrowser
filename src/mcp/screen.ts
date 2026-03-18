import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const SCREENSHOT_DIR = path.join(os.tmpdir(), 'aly-screen');
const IS_LINUX = process.platform === 'linux';
const IS_MACOS = process.platform === 'darwin';

/** Escape a string for safe use inside AppleScript double-quoted strings */
function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Escape a string for safe use in shell arguments */
function escapeShell(s: string): string {
  return s.replace(/'/g, "'\\''");
}

export function ensureDir(): void {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

/** Check if a command exists on the system */
function hasCommand(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Capture the frontmost window by default, or a specific app's window by title */
export function captureScreen(options?: { windowTitle?: string }): string {
  ensureDir();
  const filePath = path.join(SCREENSHOT_DIR, `screen-${Date.now()}.png`);

  if (IS_LINUX) {
    return captureScreenLinux(filePath, options);
  }
  return captureScreenMacos(filePath, options);
}

function captureScreenLinux(filePath: string, options?: { windowTitle?: string }): string {
  const target = options?.windowTitle;

  if (target && hasCommand('xdotool')) {
    // Try to find and capture specific window
    try {
      const windowId = execSync(
        `xdotool search --name '${escapeShell(target)}' | head -1`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();
      if (windowId && hasCommand('import')) {
        execSync(`import -window ${windowId} "${filePath}"`, { stdio: 'pipe' });
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return filePath;
      }
    } catch {}
  }

  // Fallback: full screen capture
  if (hasCommand('gnome-screenshot')) {
    execSync(`gnome-screenshot -f "${filePath}"`, { stdio: 'pipe' });
  } else if (hasCommand('import')) {
    execSync(`import -window root "${filePath}"`, { stdio: 'pipe' });
  } else if (hasCommand('scrot')) {
    execSync(`scrot "${filePath}"`, { stdio: 'pipe' });
  } else {
    throw new Error('No screenshot tool found. Install gnome-screenshot, imagemagick (import), or scrot.');
  }
  return filePath;
}

function captureScreenMacos(filePath: string, options?: { windowTitle?: string }): string {
  const target = options?.windowTitle;

  try {
    const safeTarget = target ? escapeAppleScript(target) : '';
    const script = target
      ? `tell application "System Events" to get id of front window of (first process whose name contains "${safeTarget}")`
      : `tell application "System Events" to get id of front window of first process whose frontmost is true`;
    const windowId = execSync(`osascript -e '${script}'`, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (windowId) {
      execSync(`screencapture -x -o -l ${windowId} "${filePath}"`, { stdio: 'pipe' });
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return filePath;
    }
  } catch {}

  // Fallback: full screen of main monitor
  execSync(`screencapture -x -m "${filePath}"`, { stdio: 'pipe' });
  return filePath;
}

/** Click at screen coordinates */
export function clickAt(x: number, y: number, options?: { double?: boolean }): void {
  const clicks = options?.double ? 2 : 1;

  if (IS_LINUX) {
    const repeatFlag = clicks > 1 ? `--repeat ${clicks}` : '';
    execSync(`xdotool mousemove ${x} ${y} click ${repeatFlag} 1`, { stdio: 'pipe' });
    return;
  }

  for (let i = 0; i < clicks; i++) {
    execSync(`osascript -l JavaScript -e '
      ObjC.import("CoreGraphics");
      var p = $.CGPointMake(${x}, ${y});
      var down = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, p, $.kCGMouseButtonLeft);
      var up = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, p, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, down);
      $.CGEventPost($.kCGHIDEventTap, up);
    '`, { stdio: 'pipe' });
  }
}

/** Right-click at screen coordinates */
export function rightClickAt(x: number, y: number): void {
  if (IS_LINUX) {
    execSync(`xdotool mousemove ${x} ${y} click 3`, { stdio: 'pipe' });
    return;
  }

  execSync(`osascript -l JavaScript -e '
    ObjC.import("CoreGraphics");
    var p = $.CGPointMake(${x}, ${y});
    var down = $.CGEventCreateMouseEvent(null, $.kCGEventRightMouseDown, p, $.kCGMouseButtonRight);
    var up = $.CGEventCreateMouseEvent(null, $.kCGEventRightMouseUp, p, $.kCGMouseButtonRight);
    $.CGEventPost($.kCGHIDEventTap, down);
    $.CGEventPost($.kCGHIDEventTap, up);
  '`, { stdio: 'pipe' });
}

/** Type text */
export function typeText(text: string): void {
  if (IS_LINUX) {
    execSync(`xdotool type -- '${escapeShell(text)}'`, { stdio: 'pipe' });
    return;
  }

  const escaped = escapeAppleScript(text);
  execSync(`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`, { stdio: 'pipe' });
}

/** Press a special key */
export function pressKey(key: string, modifiers?: string[]): void {
  if (IS_LINUX) {
    pressKeyLinux(key, modifiers);
    return;
  }
  pressKeyMacos(key, modifiers);
}

function pressKeyLinux(key: string, modifiers?: string[]): void {
  // xdotool key names
  const keyMap: Record<string, string> = {
    enter: 'Return', return: 'Return', tab: 'Tab', escape: 'Escape',
    delete: 'BackSpace', backspace: 'BackSpace', space: 'space',
    up: 'Up', down: 'Down', left: 'Left', right: 'Right',
    f1: 'F1', f2: 'F2', f3: 'F3', f4: 'F4', f5: 'F5',
  };

  const xdoKey = keyMap[key.toLowerCase()] || key;

  // Map modifier names to xdotool format
  const modMap: Record<string, string> = {
    command: 'super', shift: 'shift', option: 'alt', alt: 'alt', control: 'ctrl',
  };

  const modPrefix = modifiers?.length
    ? modifiers.map((m) => modMap[m.toLowerCase()] || m).join('+') + '+'
    : '';

  execSync(`xdotool key ${modPrefix}${xdoKey}`, { stdio: 'pipe' });
}

function pressKeyMacos(key: string, modifiers?: string[]): void {
  const keyMap: Record<string, number> = {
    enter: 36, return: 36, tab: 48, escape: 53, delete: 51, backspace: 51,
    space: 49, up: 126, down: 125, left: 123, right: 124,
    f1: 122, f2: 120, f3: 99, f4: 118, f5: 96,
  };

  const keyCode = keyMap[key.toLowerCase()];
  if (!keyCode) {
    typeText(key);
    return;
  }

  const modStr = modifiers?.length
    ? ` using {${modifiers.map((m) => `${m} down`).join(', ')}}`
    : '';

  execSync(
    `osascript -e 'tell application "System Events" to key code ${keyCode}${modStr}'`,
    { stdio: 'pipe' },
  );
}

/** Move mouse to coordinates */
export function moveTo(x: number, y: number): void {
  if (IS_LINUX) {
    execSync(`xdotool mousemove ${x} ${y}`, { stdio: 'pipe' });
    return;
  }

  execSync(`osascript -l JavaScript -e '
    ObjC.import("CoreGraphics");
    var p = $.CGPointMake(${x}, ${y});
    var move = $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, p, $.kCGMouseButtonLeft);
    $.CGEventPost($.kCGHIDEventTap, move);
  '`, { stdio: 'pipe' });
}

/** Scroll at current position */
export function scroll(deltaY: number): void {
  if (IS_LINUX) {
    // xdotool: button 4 = scroll up, button 5 = scroll down
    const button = deltaY > 0 ? 5 : 4;
    const clicks = Math.max(1, Math.abs(Math.round(deltaY / 3)));
    execSync(`xdotool click --repeat ${clicks} ${button}`, { stdio: 'pipe' });
    return;
  }

  execSync(`osascript -l JavaScript -e '
    ObjC.import("CoreGraphics");
    var scroll = $.CGEventCreateScrollWheelEvent(null, 0, 1, ${Math.round(deltaY)});
    $.CGEventPost($.kCGHIDEventTap, scroll);
  '`, { stdio: 'pipe' });
}

/** Get screen size */
export function getScreenSize(): { width: number; height: number } {
  if (IS_LINUX) {
    const result = execSync(
      `xdotool getdisplaygeometry`,
      { encoding: 'utf-8' },
    ).trim();
    const [width, height] = result.split(' ').map(Number);
    return { width, height };
  }

  const result = execSync(
    `osascript -l JavaScript -e 'var s = $.NSScreen.mainScreen.frame; JSON.stringify({width: s.size.width, height: s.size.height})'`,
    { encoding: 'utf-8' },
  ).trim();
  return JSON.parse(result);
}
