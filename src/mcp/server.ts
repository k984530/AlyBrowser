import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { AlyBrowser } from '../browser';
import { AlyPage } from '../page';
import { ExtensionBridge } from '../extension/bridge';
import { tools } from './tools';
import { SiteKnowledge } from './site-knowledge';

const INSTRUCTIONS = `\
AlyBrowser is a lightweight browser SDK for AI agents. \
It connects via a Chrome Extension bridge (stealth mode) that bypasses bot detection. \
Pages are read through accessibility-tree snapshots with @eN ref IDs for interactive elements. \
Always call browser_snapshot before interacting with elements to get fresh ref IDs.

## Multi-Tab Rules (MANDATORY)

When opening multiple tabs for parallel work:

1. **Agent per Tab**: Each tab MUST be operated by a dedicated agent. Agent count = Tab count (1:1 mapping). Never have a single agent switch between tabs sequentially.
2. **Pass tabId**: Give each agent its assigned tabId. Every tool call MUST include the tabId parameter.
3. **Tab Lifecycle**: When an agent finishes its task, it MUST close its tab with browser_tab_close(tabId) before terminating.
4. **Leader Cleanup**: After all agents complete, the leader should verify no orphan tabs remain via browser_tab_list.
5. **Avoid browser_tab_switch**: In multi-tab work, do NOT use browser_tab_switch. Each agent should use the tabId parameter on every tool call instead.

## Waiting for Page Load

Use browser_wait_for_stable(stableMs, timeout) instead of browser_sleep. \
It uses MutationObserver to detect when DOM changes stop, which is more reliable than fixed delays. \
Recommended: stableMs=3000, timeout=60000 for heavy SPA pages.

## Special Text Input (Slate.js, etc.)

For rich-text editors (Slate.js, ProseMirror, Draft.js): \
Use browser_click on the editor first to set focus, then browser_type to input text. \
The extension bridge dispatches proper beforeinput events that these frameworks handle correctly.

## Site Knowledge

Use browser_learn to record success/fail experiences on specific sites. \
On revisit, browser_navigate and browser_launch auto-attach recorded knowledge to the response, \
so the agent avoids repeating past mistakes.`;

const AUTO_LEARN_TOOLS = new Set([
  'browser_navigate', 'browser_click', 'browser_type', 'browser_select',
  'browser_hover', 'browser_scroll', 'browser_wait', 'browser_wait_for_stable',
  'browser_eval', 'browser_snapshot',
]);

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function jsonResult(data: unknown): ToolResult {
  return textResult(JSON.stringify(data, null, 2));
}

export class AlyBrowserMCPServer {
  private browser: AlyBrowser | null = null;
  private page: AlyPage | null = null;
  private bridge: ExtensionBridge | null = null;
  private siteKnowledge = new SiteKnowledge();
  private recentFailures = new Map<string, Set<string>>();
  readonly server: Server;

  constructor() {
    this.server = new Server(
      { name: 'aly-browser', version: '0.2.0' },
      {
        capabilities: { tools: {} },
        instructions: INSTRUCTIONS,
      },
    );
    this.registerTools();
    this.registerCleanup();
  }

  private get isStealth(): boolean {
    return this.bridge !== null;
  }

  private registerTools(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params;
      const typedArgs = args as Record<string, unknown>;
      try {
        const result = await this.handleTool(name, typedArgs);

        if (AUTO_LEARN_TOOLS.has(name)) {
          const url = await this.getCurrentUrl(typedArgs.tabId as number | undefined);
          if (url) {
            if (result.isError) {
              this.recordFailure(url, name, result.content[0]?.text ?? 'Unknown error');
            } else {
              this.recordRecovery(url, name, this.summarizeArgs(name, typedArgs));
            }
          }
        }

        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (AUTO_LEARN_TOOLS.has(name)) {
          const url = await this.getCurrentUrl(typedArgs.tabId as number | undefined);
          if (url) this.recordFailure(url, name, message);
        }

        return errorResult(message);
      }
    });
  }

  private async handleTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    switch (name) {
      // Browser control
      case 'browser_launch':
        return this.handleLaunch(args);
      case 'browser_navigate':
      case 'browser_goto': // backward compat
        return this.handleNavigate(args);
      case 'browser_back':
        return this.handleBack(args);
      case 'browser_forward':
        return this.handleForward(args);
      case 'browser_close':
        return this.handleClose();

      // Page reading
      case 'browser_snapshot':
        return this.handleSnapshot(args);
      case 'browser_html':
      case 'browser_markdown': // backward compat
        return this.handleHTML(args);
      case 'browser_eval':
        return this.handleEval(args);

      // Interaction
      case 'browser_click':
        return this.handleClick(args);
      case 'browser_type':
        return this.handleType(args);
      case 'browser_select':
        return this.handleSelect(args);
      case 'browser_hover':
        return this.handleHover(args);
      case 'browser_scroll':
        return this.handleScroll(args);
      case 'browser_wait':
        return this.handleWait(args);
      case 'browser_wait_for_stable':
        return this.handleWaitForStable(args);

      // Tabs (stealth only)
      case 'browser_tab_list':
        return this.handleTabList();
      case 'browser_tab_new':
        return this.handleTabNew(args);
      case 'browser_tab_close':
        return this.handleTabClose(args);
      case 'browser_tab_switch':
        return this.handleTabSwitch(args);

      // Cookies (stealth only)
      case 'browser_cookie_get':
        return this.handleCookieGet(args);
      case 'browser_cookie_set':
        return this.handleCookieSet(args);
      case 'browser_cookie_delete':
        return this.handleCookieDelete(args);

      // Downloads (stealth only)
      case 'browser_download':
        return this.handleDownload(args);

      // History (stealth only)
      case 'browser_history_search':
        return this.handleHistorySearch(args);

      // Alarms (stealth only)
      case 'browser_alarm_create':
        return this.handleAlarmCreate(args);
      case 'browser_alarm_list':
        return this.handleAlarmList();
      case 'browser_alarm_clear':
        return this.handleAlarmClear(args);

      // Storage (stealth only)
      case 'browser_storage_get':
        return this.handleStorageGet(args);
      case 'browser_storage_set':
        return this.handleStorageSet(args);

      // Notifications (stealth only)
      case 'browser_notify':
        return this.handleNotify(args);

      // Bookmarks (stealth only)
      case 'browser_bookmark_list':
        return this.handleBookmarkList(args);
      case 'browser_bookmark_create':
        return this.handleBookmarkCreate(args);
      case 'browser_bookmark_delete':
        return this.handleBookmarkDelete(args);

      // Sleep
      case 'browser_sleep':
        return this.handleSleep();

      // Site Knowledge
      case 'browser_learn':
        return this.handleLearn(args);
      case 'browser_get_knowledge':
        return this.handleGetKnowledge(args);

      // Top Sites (stealth only)
      case 'browser_top_sites':
        return this.handleTopSites();

      // Clipboard (stealth only)
      case 'browser_clipboard_read':
        return this.handleClipboardRead(args);
      case 'browser_clipboard_write':
        return this.handleClipboardWrite(args);

      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  }

  // ── Browser Control ─────────────────────────────────────────

  private async handleLaunch(args: Record<string, unknown>): Promise<ToolResult> {
    // Clean up existing sessions
    await this.cleanupAll();

    const stealth = (args.stealth as boolean | undefined) ?? true;

    if (stealth) {
      this.bridge = new ExtensionBridge();
      await this.bridge.launch({ url: args.url as string | undefined });

      if (args.url) {
        const knowledge = this.siteKnowledge.formatForContext(args.url as string);
        const prefix = knowledge ? `${knowledge}\n\n` : '';
        const snapshot = await this.bridge.snapshot();
        return textResult(
          `Browser launched (stealth) → ${args.url}\n\n${prefix}${snapshot}`,
        );
      }
      return textResult('Browser launched in stealth mode (extension bridge).');
    }

    // CDP mode
    const headless = (args.headless as boolean | undefined) ?? true;
    this.browser = await AlyBrowser.launch({ headless });
    this.page = await this.browser.newPage();

    if (args.url) {
      const knowledge = this.siteKnowledge.formatForContext(args.url as string);
      const prefix = knowledge ? `${knowledge}\n\n` : '';
      await this.page.goto(args.url as string);
      const snapshot = await this.page.snapshot();
      return textResult(
        `Browser launched (CDP) → ${args.url}\n\n${prefix}${snapshot.accessibilityText}`,
      );
    }
    return textResult('Browser launched (CDP mode).');
  }

  private async handleNavigate(args: Record<string, unknown>): Promise<ToolResult> {
    const url = args.url as string;
    const tabId = args.tabId as number | undefined;
    const knowledge = this.siteKnowledge.formatForContext(url);
    const prefix = knowledge ? `${knowledge}\n\n` : '';

    if (this.bridge) {
      await this.bridge.navigate(url, tabId);
      const snap = await this.bridge.snapshot(tabId);
      return textResult(`${prefix}${snap}`);
    }
    const page = this.ensurePage();
    await page.goto(url);
    const snap = await page.snapshot();
    return textResult(`${prefix}${snap.accessibilityText}`);
  }

  private async handleBack(args: Record<string, unknown>): Promise<ToolResult> {
    const tabId = args.tabId as number | undefined;
    if (this.bridge) {
      await this.bridge.goBack(tabId);
      const snap = await this.bridge.snapshot(tabId);
      return textResult(snap);
    }
    const page = this.ensurePage();
    await page.goBack();
    const snap = await page.snapshot();
    return textResult(snap.accessibilityText);
  }

  private async handleForward(args: Record<string, unknown>): Promise<ToolResult> {
    const tabId = args.tabId as number | undefined;
    if (this.bridge) {
      await this.bridge.goForward(tabId);
      const snap = await this.bridge.snapshot(tabId);
      return textResult(snap);
    }
    const page = this.ensurePage();
    await page.goForward();
    const snap = await page.snapshot();
    return textResult(snap.accessibilityText);
  }

  private async handleClose(): Promise<ToolResult> {
    await this.cleanupAll();
    return textResult('Browser closed.');
  }

  // ── Page Reading ────────────────────────────────────────────

  private async handleSnapshot(args: Record<string, unknown>): Promise<ToolResult> {
    const tabId = args.tabId as number | undefined;
    if (this.bridge) {
      return textResult(await this.bridge.snapshot(tabId));
    }
    const page = this.ensurePage();
    const snap = await page.snapshot();
    return textResult(snap.accessibilityText);
  }

  private async handleHTML(args: Record<string, unknown>): Promise<ToolResult> {
    const tabId = args.tabId as number | undefined;
    if (this.bridge) {
      return textResult(await this.bridge.getHTML(tabId));
    }
    const page = this.ensurePage();
    const snap = await page.snapshot();
    return textResult(snap.markdown);
  }

  private async handleEval(args: Record<string, unknown>): Promise<ToolResult> {
    const expr = args.expression as string;
    const tabId = args.tabId as number | undefined;
    if (this.bridge) {
      const result = await this.bridge.evaluate(expr, tabId);
      return textResult(
        typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      );
    }
    const page = this.ensurePage();
    const result = await page.evaluate(expr);
    return textResult(
      typeof result === 'string' ? result : JSON.stringify(result, null, 2),
    );
  }

  // ── Page Interaction ────────────────────────────────────────

  private async handleClick(args: Record<string, unknown>): Promise<ToolResult> {
    const ref = args.ref as string;
    const tabId = args.tabId as number | undefined;
    if (this.bridge) {
      await this.bridge.click(ref, tabId);
      const snap = await this.bridge.snapshot(tabId);
      return textResult(`Clicked ${ref}\n\n${snap}`);
    }
    const page = this.ensurePage();
    await page.click(ref);
    const snap = await page.snapshot();
    return textResult(`Clicked ${ref}\n\n${snap.accessibilityText}`);
  }

  private async handleType(args: Record<string, unknown>): Promise<ToolResult> {
    const ref = args.ref as string;
    const text = args.text as string;
    const clear = (args.clear as boolean) ?? false;
    const tabId = args.tabId as number | undefined;
    if (this.bridge) {
      await this.bridge.type(ref, text, { clear, tabId });
      const snap = await this.bridge.snapshot(tabId);
      return textResult(`Typed "${text}" → ${ref}\n\n${snap}`);
    }
    const page = this.ensurePage();
    await page.type(ref, text, { clear });
    const snap = await page.snapshot();
    return textResult(`Typed "${text}" → ${ref}\n\n${snap.accessibilityText}`);
  }

  private async handleSelect(args: Record<string, unknown>): Promise<ToolResult> {
    const ref = args.ref as string;
    const value = args.value as string;
    const tabId = args.tabId as number | undefined;
    if (this.bridge) {
      await this.bridge.selectOption(ref, value, tabId);
      const snap = await this.bridge.snapshot(tabId);
      return textResult(`Selected "${value}" in ${ref}\n\n${snap}`);
    }
    const page = this.ensurePage();
    await page.selectOption(ref, value);
    const snap = await page.snapshot();
    return textResult(`Selected "${value}" in ${ref}\n\n${snap.accessibilityText}`);
  }

  private async handleHover(args: Record<string, unknown>): Promise<ToolResult> {
    const ref = args.ref as string;
    const tabId = args.tabId as number | undefined;
    if (this.bridge) {
      await this.bridge.hover(ref, tabId);
      const snap = await this.bridge.snapshot(tabId);
      return textResult(`Hovered ${ref}\n\n${snap}`);
    }
    const page = this.ensurePage();
    await page.hover(ref);
    const snap = await page.snapshot();
    return textResult(`Hovered ${ref}\n\n${snap.accessibilityText}`);
  }

  private async handleScroll(args: Record<string, unknown>): Promise<ToolResult> {
    const x = (args.x as number) ?? 0;
    const y = (args.y as number) ?? 0;
    const tabId = args.tabId as number | undefined;
    if (this.bridge) {
      await this.bridge.scrollBy({ x, y, tabId });
      const snap = await this.bridge.snapshot(tabId);
      return textResult(`Scrolled (${x}, ${y})\n\n${snap}`);
    }
    const page = this.ensurePage();
    await page.scrollBy({ x, y });
    const snap = await page.snapshot();
    return textResult(`Scrolled (${x}, ${y})\n\n${snap.accessibilityText}`);
  }

  private async handleWait(args: Record<string, unknown>): Promise<ToolResult> {
    const selector = args.selector as string;
    const timeout = args.timeout as number | undefined;
    const hidden = (args.hidden as boolean) ?? false;
    const tabId = args.tabId as number | undefined;
    if (this.bridge) {
      await this.bridge.waitForSelector(selector, { timeout, hidden, tabId });
      return textResult(hidden
        ? `Element "${selector}" disappeared.`
        : `Element "${selector}" found.`);
    }
    const page = this.ensurePage();
    await page.waitForSelector(selector, { timeout });
    return textResult(`Element "${selector}" found.`);
  }

  private async handleWaitForStable(args: Record<string, unknown>): Promise<ToolResult> {
    const timeout = args.timeout as number | undefined;
    const stableMs = args.stableMs as number | undefined;
    const tabId = args.tabId as number | undefined;
    if (this.bridge) {
      await this.bridge.waitForStable({ timeout, stableMs, tabId });
      return textResult('DOM stabilized.');
    }
    const page = this.ensurePage();
    // CDP mode: use waitForSelector as fallback (no MutationObserver support)
    await new Promise((r) => setTimeout(r, stableMs ?? 1000));
    return textResult('Waited for DOM stability (CDP fallback).');
  }

  // ── Tab Management (stealth only) ───────────────────────────

  private async handleTabList(): Promise<ToolResult> {
    this.ensureBridge('browser_tab_list');
    return jsonResult(await this.bridge!.tabList());
  }

  private async handleTabNew(args: Record<string, unknown>): Promise<ToolResult> {
    this.ensureBridge('browser_tab_new');
    const result = await this.bridge!.tabNew(args.url as string | undefined);
    return jsonResult(result);
  }

  private async handleTabClose(args: Record<string, unknown>): Promise<ToolResult> {
    this.ensureBridge('browser_tab_close');
    await this.bridge!.tabClose(args.tabId as number | undefined);
    return textResult('Tab closed.');
  }

  private async handleTabSwitch(args: Record<string, unknown>): Promise<ToolResult> {
    this.ensureBridge('browser_tab_switch');
    await this.bridge!.tabSwitch(args.tabId as number);
    return textResult(`Switched to tab ${args.tabId}.`);
  }

  // ── Cookies (stealth only) ──────────────────────────────────

  private async handleCookieGet(args: Record<string, unknown>): Promise<ToolResult> {
    this.ensureBridge('browser_cookie_get');
    const cookies = await this.bridge!.cookieGet(
      args.url as string,
      args.name as string | undefined,
    );
    return jsonResult(cookies);
  }

  private async handleCookieSet(args: Record<string, unknown>): Promise<ToolResult> {
    this.ensureBridge('browser_cookie_set');
    await this.bridge!.cookieSet(args);
    return textResult('Cookie set.');
  }

  private async handleCookieDelete(args: Record<string, unknown>): Promise<ToolResult> {
    this.ensureBridge('browser_cookie_delete');
    await this.bridge!.cookieDelete(args.url as string, args.name as string);
    return textResult('Cookie deleted.');
  }

  // ── Downloads (stealth only) ────────────────────────────────

  private async handleDownload(args: Record<string, unknown>): Promise<ToolResult> {
    this.ensureBridge('browser_download');
    const result = await this.bridge!.download(
      args.url as string,
      args.filename as string | undefined,
    );
    return jsonResult(result);
  }

  // ── History (stealth only) ──────────────────────────────────

  private async handleHistorySearch(args: Record<string, unknown>): Promise<ToolResult> {
    this.ensureBridge('browser_history_search');
    const results = await this.bridge!.historySearch(
      args.query as string | undefined,
      args.maxResults as number | undefined,
    );
    return jsonResult(results);
  }

  // ── Alarms (stealth only) ───────────────────────────────────

  private async handleAlarmCreate(args: Record<string, unknown>): Promise<ToolResult> {
    this.ensureBridge('browser_alarm_create');
    const result = await this.bridge!.alarmCreate(args.name as string, {
      delayInMinutes: args.delayInMinutes,
      periodInMinutes: args.periodInMinutes,
    });
    return jsonResult(result);
  }

  private async handleAlarmList(): Promise<ToolResult> {
    this.ensureBridge('browser_alarm_list');
    return jsonResult(await this.bridge!.alarmList());
  }

  private async handleAlarmClear(args: Record<string, unknown>): Promise<ToolResult> {
    this.ensureBridge('browser_alarm_clear');
    await this.bridge!.alarmClear(args.name as string | undefined);
    return textResult('Alarm cleared.');
  }

  // ── Storage (stealth only) ──────────────────────────────────

  private async handleStorageGet(args: Record<string, unknown>): Promise<ToolResult> {
    this.ensureBridge('browser_storage_get');
    const data = await this.bridge!.storageGet(args.keys as string[] | undefined);
    return jsonResult(data);
  }

  private async handleStorageSet(args: Record<string, unknown>): Promise<ToolResult> {
    this.ensureBridge('browser_storage_set');
    await this.bridge!.storageSet(args.data as Record<string, unknown>);
    return textResult('Storage updated.');
  }

  // ── Notifications (stealth only) ────────────────────────────

  private async handleNotify(args: Record<string, unknown>): Promise<ToolResult> {
    this.ensureBridge('browser_notify');
    const result = await this.bridge!.notify(
      args.title as string,
      args.message as string,
    );
    return jsonResult(result);
  }

  // ── Bookmarks (stealth only) ──────────────────────────────

  private async handleBookmarkList(args: Record<string, unknown>): Promise<ToolResult> {
    this.ensureBridge('browser_bookmark_list');
    const results = await this.bridge!.bookmarkList(args.query as string | undefined);
    return jsonResult(results);
  }

  private async handleBookmarkCreate(args: Record<string, unknown>): Promise<ToolResult> {
    this.ensureBridge('browser_bookmark_create');
    const result = await this.bridge!.bookmarkCreate(
      args.title as string,
      args.url as string,
      args.parentId as string | undefined,
    );
    return jsonResult(result);
  }

  private async handleBookmarkDelete(args: Record<string, unknown>): Promise<ToolResult> {
    this.ensureBridge('browser_bookmark_delete');
    await this.bridge!.bookmarkDelete(args.id as string);
    return textResult('Bookmark deleted.');
  }

  // ── Top Sites (stealth only) ──────────────────────────────

  private async handleTopSites(): Promise<ToolResult> {
    this.ensureBridge('browser_top_sites');
    return jsonResult(await this.bridge!.topSites());
  }

  // ── Clipboard (stealth only) ──────────────────────────────

  private async handleClipboardRead(args: Record<string, unknown>): Promise<ToolResult> {
    this.ensureBridge('browser_clipboard_read');
    const tabId = args.tabId as number | undefined;
    const text = await this.bridge!.clipboardRead(tabId);
    return textResult(typeof text === 'string' ? text : JSON.stringify(text));
  }

  private async handleClipboardWrite(args: Record<string, unknown>): Promise<ToolResult> {
    this.ensureBridge('browser_clipboard_write');
    const tabId = args.tabId as number | undefined;
    await this.bridge!.clipboardWrite(args.text as string, tabId);
    return textResult('Clipboard updated.');
  }

  // ── Sleep ──────────────────────────────────────────────────

  private async handleSleep(): Promise<ToolResult> {
    await new Promise((r) => setTimeout(r, 1000));
    return textResult('Waited 1 second.');
  }

  // ── Site Knowledge ─────────────────────────────────────────

  private async handleLearn(args: Record<string, unknown>): Promise<ToolResult> {
    const url = args.url as string;
    const action = args.action as string;
    const result = args.result as string;
    const note = args.note as string;
    if (result !== 'success' && result !== 'fail') {
      return errorResult(`Invalid result: "${result}". Must be "success" or "fail".`);
    }
    this.siteKnowledge.add(url, action, result, note);
    return textResult(`Recorded: (${result}) ${action} on ${url}`);
  }

  private async handleGetKnowledge(args: Record<string, unknown>): Promise<ToolResult> {
    let url = args.url as string | undefined;
    if (!url) {
      if (this.bridge) {
        const href = await this.bridge.evaluate('location.href');
        url = typeof href === 'string' ? href : String(href);
      } else if (this.page) {
        const href = await this.page.evaluate('location.href');
        url = typeof href === 'string' ? href : String(href);
      } else {
        return errorResult('No browser running and no URL provided.');
      }
    }
    const entries = this.siteKnowledge.query(url);
    if (entries.length === 0) {
      return textResult(`No knowledge recorded for ${url}`);
    }
    return textResult(this.siteKnowledge.formatForContext(url)!);
  }

  // ── Auto-Learn ──────────────────────────────────────────────

  private async getCurrentUrl(tabId?: number): Promise<string | null> {
    try {
      if (this.bridge) {
        const href = await this.bridge.evaluate('location.href', tabId);
        return typeof href === 'string' ? href : String(href);
      }
      if (this.page) {
        const href = await this.page.evaluate('location.href');
        return typeof href === 'string' ? href : String(href);
      }
    } catch {}
    return null;
  }

  private getDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }

  private recordFailure(url: string, toolName: string, error: string): void {
    const domain = this.getDomain(url);
    if (!this.recentFailures.has(domain)) {
      this.recentFailures.set(domain, new Set());
    }
    this.recentFailures.get(domain)!.add(toolName);
    this.siteKnowledge.add(url, toolName, 'fail', error);
  }

  private recordRecovery(url: string, toolName: string, detail: string): void {
    const domain = this.getDomain(url);
    const failures = this.recentFailures.get(domain);
    if (failures?.has(toolName)) {
      this.siteKnowledge.add(url, toolName, 'success', detail);
      failures.delete(toolName);
    }
  }

  private summarizeArgs(name: string, args: Record<string, unknown>): string {
    const { tabId, ...rest } = args;
    const parts = Object.entries(rest).map(([k, v]) => {
      const val = typeof v === 'string' && v.length > 50 ? v.slice(0, 50) + '...' : v;
      return `${k}=${val}`;
    });
    return parts.join(', ') || 'no args';
  }

  // ── Helpers ─────────────────────────────────────────────────

  private ensurePage(): AlyPage {
    if (!this.page) {
      throw new Error('No browser running. Call browser_launch first.');
    }
    return this.page;
  }

  private ensureBridge(toolName: string): void {
    if (!this.bridge) {
      throw new Error(
        `${toolName} requires stealth mode. Launch with browser_launch(stealth: true).`,
      );
    }
  }

  private async cleanupAll(): Promise<void> {
    if (this.bridge) {
      await this.bridge.close().catch(() => {});
      this.bridge = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.page = null;
    }
  }

  private registerCleanup(): void {
    const onExit = () => {
      this.cleanupAll().catch(() => {});
    };
    process.on('SIGINT', onExit);
    process.on('SIGTERM', onExit);
  }
}
