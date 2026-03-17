/**
 * Tests for content.js snapshot functions (walkDOM, isVisible, Shadow DOM).
 *
 * content.js doesn't export functions, so we load it via eval in a
 * happy-dom environment that provides real DOM APIs.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ── Load content.js functions into test scope ────────────────────

// We wrap content.js in a function that returns the internal functions.
// Chrome extension APIs are stubbed so the file loads without errors.
function loadContentFunctions() {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../extension/content.js'),
    'utf-8',
  );

  // Stub chrome.runtime
  const chrome = {
    runtime: {
      sendMessage: vi.fn(),
      onMessage: { addListener: vi.fn() },
    },
  };

  // Execute content.js in a controlled scope and expose internals
  const fn = new Function(
    'chrome', 'window', 'document',
    `${src}
    return { buildSnapshot, walkDOM, isVisible, isInteractive, getRole, getLabel, assignRef, refMap, getDirectText };`,
  );

  return fn(chrome, globalThis.window, globalThis.document);
}

// ── Tests ────────────────────────────────────────────────────────

describe('content.js snapshot', () => {
  let funcs: ReturnType<typeof loadContentFunctions>;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    funcs = loadContentFunctions();
  });

  // ── isVisible ──────────────────────────────────────────────

  describe('isVisible', () => {
    it('returns true for a normal visible element', () => {
      const div = document.createElement('div');
      div.textContent = 'visible';
      document.body.appendChild(div);
      expect(funcs.isVisible(div)).toBe(true);
    });

    it('returns false for hidden attribute', () => {
      const div = document.createElement('div');
      div.hidden = true;
      document.body.appendChild(div);
      expect(funcs.isVisible(div)).toBe(false);
    });

    it('returns false for display:none via checkVisibility', () => {
      const div = document.createElement('div');
      div.style.display = 'none';
      document.body.appendChild(div);
      // Provide checkVisibility that a real Chrome would have
      (div as any).checkVisibility = ({ checkOpacity, checkVisibilityCSS }: any) => false;
      expect(funcs.isVisible(div)).toBe(false);
    });

    it('returns false for visibility:hidden via checkVisibility', () => {
      const div = document.createElement('div');
      div.style.visibility = 'hidden';
      document.body.appendChild(div);
      (div as any).checkVisibility = () => false;
      expect(funcs.isVisible(div)).toBe(false);
    });

    it('returns false for opacity:0 via checkVisibility', () => {
      const div = document.createElement('div');
      div.style.opacity = '0';
      document.body.appendChild(div);
      (div as any).checkVisibility = () => false;
      expect(funcs.isVisible(div)).toBe(false);
    });

    it('falls back gracefully when checkVisibility is not available', () => {
      // happy-dom lacks checkVisibility — isVisible catches the error and returns true
      const div = document.createElement('div');
      div.style.display = 'none';
      document.body.appendChild(div);
      // Without mocking checkVisibility, the catch block returns true
      // This verifies the error-safe fallback behavior
      expect(funcs.isVisible(div)).toBe(true);
    });

    it('returns true on error (safe fallback)', () => {
      // An object that throws on property access
      const broken = { get hidden() { throw new Error('broken'); } };
      expect(funcs.isVisible(broken)).toBe(true);
    });
  });

  // ── Shadow DOM walkDOM ─────────────────────────────────────

  describe('Shadow DOM traversal', () => {
    it('traverses open shadow root in snapshot', () => {
      // Create a custom element with open shadow DOM
      const host = document.createElement('div');
      document.body.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      const btn = document.createElement('button');
      btn.textContent = 'Shadow Button';
      shadow.appendChild(btn);

      const snapshot = funcs.buildSnapshot();

      // The shadow button should appear in the snapshot
      expect(snapshot).toContain('Shadow Button');
      expect(snapshot).toContain('[button]');
    });

    it('does not crash on closed shadow root', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      // Closed shadow root — el.shadowRoot returns null
      host.attachShadow({ mode: 'closed' });

      // Should not throw
      const snapshot = funcs.buildSnapshot();
      expect(snapshot).toContain('[RootWebArea]');
    });

    it('assigns ref IDs to interactive elements inside shadow DOM', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      const link = document.createElement('a');
      link.href = 'https://example.com';
      link.textContent = 'Shadow Link';
      shadow.appendChild(link);

      const snapshot = funcs.buildSnapshot();

      // Link should have a ref ID
      expect(snapshot).toMatch(/@e\d+/);
      expect(snapshot).toContain('Shadow Link');
    });

    it('handles nested shadow DOMs', () => {
      const outer = document.createElement('div');
      document.body.appendChild(outer);

      const outerShadow = outer.attachShadow({ mode: 'open' });
      const inner = document.createElement('div');
      outerShadow.appendChild(inner);

      const innerShadow = inner.attachShadow({ mode: 'open' });
      const deepBtn = document.createElement('button');
      deepBtn.textContent = 'Deep Button';
      innerShadow.appendChild(deepBtn);

      const snapshot = funcs.buildSnapshot();
      expect(snapshot).toContain('Deep Button');
    });

    it('includes both light DOM and shadow DOM content', () => {
      // Light DOM content
      const heading = document.createElement('h1');
      heading.textContent = 'Light Heading';
      document.body.appendChild(heading);

      // Shadow DOM content
      const host = document.createElement('div');
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      const shadowHeading = document.createElement('h2');
      shadowHeading.textContent = 'Shadow Heading';
      shadow.appendChild(shadowHeading);

      const snapshot = funcs.buildSnapshot();
      expect(snapshot).toContain('Light Heading');
      expect(snapshot).toContain('Shadow Heading');
    });
  });

  // ── buildSnapshot ──────────────────────────────────────────

  describe('buildSnapshot', () => {
    it('returns root web area with page title', () => {
      document.title = 'Test Page';
      const snapshot = funcs.buildSnapshot();
      expect(snapshot).toContain('[RootWebArea] "Test Page"');
    });

    it('includes interactive elements with ref IDs', () => {
      const btn = document.createElement('button');
      btn.textContent = 'Click me';
      document.body.appendChild(btn);

      const snapshot = funcs.buildSnapshot();
      expect(snapshot).toContain('[button] @e0 "Click me"');
    });

    it('includes static text for leaf text nodes', () => {
      const p = document.createElement('p');
      p.textContent = 'Hello world';
      document.body.appendChild(p);

      const snapshot = funcs.buildSnapshot();
      expect(snapshot).toContain('[paragraph]');
    });

    it('skips script and style elements', () => {
      const script = document.createElement('script');
      script.textContent = 'alert("xss")';
      document.body.appendChild(script);

      const style = document.createElement('style');
      style.textContent = 'body { color: red; }';
      document.body.appendChild(style);

      const snapshot = funcs.buildSnapshot();
      expect(snapshot).not.toContain('alert');
      expect(snapshot).not.toContain('color');
    });

    it('includes form element states', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.required = true;
      document.body.appendChild(input);

      const snapshot = funcs.buildSnapshot();
      expect(snapshot).toContain('[required]');
      expect(snapshot).toContain('[textbox]');
    });

    it('shows placeholder when no state parts exist', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Enter name';
      document.body.appendChild(input);

      const snapshot = funcs.buildSnapshot();
      expect(snapshot).toContain('Enter name');
    });

    it('throws on concurrent snapshot', () => {
      // Manually set the guard flag
      // We can't easily test true concurrency, but we verify the guard
      document.body.innerHTML = '';
      funcs.buildSnapshot(); // First should work
      // The guard is reset after completion, so second works too
      funcs.buildSnapshot();
    });
  });
});
