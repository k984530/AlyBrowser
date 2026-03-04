import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'path';
import { AlyBrowser } from '../../src/index';
import type { AlyPage } from '../../src/page';

const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/sample-pages/basic.html');
const FIXTURE_URL = `file://${FIXTURE_PATH}`;

describe('AlyBrowser Integration', () => {
  let browser: AlyBrowser | null = null;

  afterEach(async () => {
    if (browser) {
      await browser.close();
      browser = null;
    }
  });

  it('launches Chrome and creates a page', async () => {
    browser = await AlyBrowser.launch();
    const page = await browser.newPage();

    expect(page).toBeDefined();
    expect(page.targetId).toBeTruthy();
  });

  it('navigates to a URL and gets title', async () => {
    browser = await AlyBrowser.launch();
    const page = await browser.newPage();

    await page.goto(FIXTURE_URL);
    const title = await page.title();

    expect(title).toBe('Test Page');
  });

  it('evaluates JavaScript', async () => {
    browser = await AlyBrowser.launch();
    const page = await browser.newPage();

    await page.goto(FIXTURE_URL);
    const result = await page.evaluate<number>('1 + 2');

    expect(result).toBe(3);
  });

  it('takes a snapshot with accessibility tree', async () => {
    browser = await AlyBrowser.launch();
    const page = await browser.newPage();

    await page.goto(FIXTURE_URL);
    const snap = await page.snapshot();

    // Basic snapshot properties
    expect(snap.url).toContain('basic.html');
    expect(snap.title).toBe('Test Page');
    expect(snap.accessibilityTree).toBeDefined();
    expect(snap.accessibilityTree.role).toMatch(/WebArea/);

    // Should have interactive elements
    expect(snap.elements.length).toBeGreaterThan(0);

    // Elements should have refs
    for (const el of snap.elements) {
      expect(el.ref).toMatch(/^@e\d+$/);
    }

    // Accessibility text should be non-empty
    expect(snap.accessibilityText.length).toBeGreaterThan(0);
    expect(snap.accessibilityText).toMatch(/WebArea/);
  });

  it('extracts markdown from a page', async () => {
    browser = await AlyBrowser.launch();
    const page = await browser.newPage();

    await page.goto(FIXTURE_URL);
    const snap = await page.snapshot();

    // Markdown should contain page content
    expect(snap.markdown).toContain('Welcome to Test Page');
    expect(snap.markdown).toContain('bold text');
    expect(snap.markdown).toContain('italic text');
  });

  it('extracts page metadata', async () => {
    browser = await AlyBrowser.launch();
    const page = await browser.newPage();

    await page.goto(FIXTURE_URL);
    const snap = await page.snapshot();

    expect(snap.meta.language).toBe('en');
    expect(snap.meta.description).toBe('A test page for AlyBrowser');
  });

  it('waits for a selector', async () => {
    browser = await AlyBrowser.launch();
    const page = await browser.newPage();

    await page.goto(FIXTURE_URL);
    await page.waitForSelector('h1');
    // No error means success
  });

  it('types text into an input', async () => {
    browser = await AlyBrowser.launch();
    const page = await browser.newPage();

    await page.goto(FIXTURE_URL);
    const snap = await page.snapshot();

    // Find the search input ref
    const searchInput = snap.elements.find(
      (e) => e.role === 'searchbox' || e.role === 'textbox',
    );
    expect(searchInput).toBeDefined();

    await page.type(searchInput!.ref, 'hello world');

    // Verify the value was typed
    const value = await page.evaluate<string>(
      `document.querySelector('input[type="search"]').value`,
    );
    expect(value).toBe('hello world');
  });

  it('clicks a button', async () => {
    browser = await AlyBrowser.launch();
    const page = await browser.newPage();

    await page.goto(FIXTURE_URL);

    // Add a click handler to track clicks
    await page.evaluate(`
      window.__clicked = false;
      document.querySelector('button').addEventListener('click', () => {
        window.__clicked = true;
      });
    `);

    const snap = await page.snapshot();
    const button = snap.elements.find((e) => e.role === 'button');
    expect(button).toBeDefined();

    await page.click(button!.ref);

    const clicked = await page.evaluate<boolean>('window.__clicked');
    expect(clicked).toBe(true);
  });

  it('lists pages', async () => {
    browser = await AlyBrowser.launch();
    await browser.newPage();

    const pages = await browser.pages();
    expect(pages.length).toBeGreaterThanOrEqual(1);
  });

  it('closes browser cleanly', async () => {
    browser = await AlyBrowser.launch();
    await browser.close();
    browser = null; // prevent double close in afterEach
  });
});
