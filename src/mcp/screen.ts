import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const SCREENSHOT_DIR = path.join(os.tmpdir(), 'aly-screen');

export function ensureDir(): void {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

/** Capture the frontmost window, a specific window by title, or the main monitor */
export function captureScreen(options?: { windowTitle?: string }): string {
  ensureDir();
  const filePath = path.join(SCREENSHOT_DIR, `screen-${Date.now()}.png`);

  // Default: capture the frontmost window (works correctly on multi-monitor)
  const target = options?.windowTitle || getFrontmostApp();

  if (target) {
    try {
      const windowId = execSync(
        `osascript -l JavaScript -e '
          var app = Application("System Events");
          var procs = app.processes.whose({frontmost: true});
          if ("${options?.windowTitle || ''}") {
            procs = app.processes.whose({name: {_contains: "${target}"}});
          }
          if (procs.length > 0) {
            var wins = procs[0].windows();
            if (wins.length > 0) { wins[0].attributes.byName("AXIdentifier").value(); }
          }
        '`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      ).trim();

      if (windowId) {
        execSync(`screencapture -x -l ${windowId} "${filePath}"`, { stdio: 'pipe' });
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return filePath;
      }
    } catch {}
  }

  // Fallback: capture main monitor only (-m flag for multi-monitor)
  execSync(`screencapture -x -m "${filePath}"`, { stdio: 'pipe' });
  return filePath;
}

function getFrontmostApp(): string | null {
  try {
    return execSync(
      `osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim() || null;
  } catch { return null; }
}

/** Click at screen coordinates using CoreGraphics via JXA */
export function clickAt(x: number, y: number, options?: { double?: boolean }): void {
  const clicks = options?.double ? 2 : 1;
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
  execSync(`osascript -l JavaScript -e '
    ObjC.import("CoreGraphics");
    var p = $.CGPointMake(${x}, ${y});
    var down = $.CGEventCreateMouseEvent(null, $.kCGEventRightMouseDown, p, $.kCGMouseButtonRight);
    var up = $.CGEventCreateMouseEvent(null, $.kCGEventRightMouseUp, p, $.kCGMouseButtonRight);
    $.CGEventPost($.kCGHIDEventTap, down);
    $.CGEventPost($.kCGHIDEventTap, up);
  '`, { stdio: 'pipe' });
}

/** Type text using System Events */
export function typeText(text: string): void {
  // Escape single quotes for osascript
  const escaped = text.replace(/'/g, "'\"'\"'");
  execSync(`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`, { stdio: 'pipe' });
}

/** Press a special key */
export function pressKey(key: string, modifiers?: string[]): void {
  const keyMap: Record<string, number> = {
    enter: 36, return: 36, tab: 48, escape: 53, delete: 51, backspace: 51,
    space: 49, up: 126, down: 125, left: 123, right: 124,
    f1: 122, f2: 120, f3: 99, f4: 118, f5: 96,
  };

  const keyCode = keyMap[key.toLowerCase()];
  if (!keyCode) {
    // If not a special key, type it as text
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
  execSync(`osascript -l JavaScript -e '
    ObjC.import("CoreGraphics");
    var p = $.CGPointMake(${x}, ${y});
    var move = $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, p, $.kCGMouseButtonLeft);
    $.CGEventPost($.kCGHIDEventTap, move);
  '`, { stdio: 'pipe' });
}

/** Scroll at current position */
export function scroll(deltaY: number): void {
  execSync(`osascript -l JavaScript -e '
    ObjC.import("CoreGraphics");
    var scroll = $.CGEventCreateScrollWheelEvent(null, 0, 1, ${Math.round(deltaY)});
    $.CGEventPost($.kCGHIDEventTap, scroll);
  '`, { stdio: 'pipe' });
}

/** Get screen size */
export function getScreenSize(): { width: number; height: number } {
  const result = execSync(
    `osascript -l JavaScript -e 'var s = $.NSScreen.mainScreen.frame; JSON.stringify({width: s.size.width, height: s.size.height})'`,
    { encoding: 'utf-8' },
  ).trim();
  return JSON.parse(result);
}
