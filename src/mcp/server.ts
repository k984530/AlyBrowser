import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import { ExtensionBridge } from '../extension/bridge';
import { tools } from './tools';
import { SiteKnowledge } from './site-knowledge';
import * as screen from './screen';
import { snapshotDiff } from '../utils/snapshot-diff';

const INSTRUCTIONS = `\
AlyBrowser is a lightweight browser SDK for AI agents. \
It connects via a Chrome Extension bridge that bypasses bot detection. \
Pages are read through accessibility-tree snapshots with @eN ref IDs for interactive elements. \
Always call browser_snapshot before interacting with elements to get fresh ref IDs.

## Multi-Session Support

Each browser session is an isolated Chrome instance with its own cookies, profile, and login state. \
Use different sessionId values for multi-account scenarios (e.g., sessionId "insta-a" and "insta-b" for two Instagram accounts). \
If sessionId is omitted, the "default" session is used. Use browser_session_list to see active sessions.

## Multi-Tab Rules (MANDATORY)

When opening multiple tabs for parallel work:

1. **Agent per Tab**: Each tab MUST be operated by a dedicated agent. Agent count = Tab count (1:1 mapping). Never have a single agent switch between tabs sequentially.
2. **Pass tabId**: Give each agent its assigned tabId. Every tool call MUST include the tabId parameter.
3. **Tab Lifecycle**: When an agent finishes its task, it MUST close its tab with browser_tab_close(tabId) before terminating.
4. **Leader Cleanup**: After all agents complete, the leader should verify no orphan tabs remain via browser_tab_list.
5. **Avoid browser_tab_switch**: In multi-tab work, do NOT use browser_tab_switch. Each agent should use the tabId parameter on every tool call instead.

## Waiting for Page Load

Use browser_wait_for_stable(timeout) instead of browser_sleep. \
It uses MutationObserver to detect when DOM changes stop (500ms quiet period), which is more reliable than fixed delays.

## Special Text Input (Slate.js, etc.)

For rich-text editors (Slate.js, ProseMirror, Draft.js): \
Use browser_click on the editor first to set focus, then browser_type to input text. \
The extension bridge dispatches proper beforeinput events that these frameworks handle correctly.

## Site Knowledge (Core Feature)

IMPORTANT: Site Knowledge is a core feature that dramatically improves reliability across sessions. \
Use browser_learn proactively to record what works and what doesn't on each site.

When to record knowledge:
- After discovering a working approach (e.g., "Slate.js editor requires browser_click before browser_type")
- After a failure and recovery (e.g., "Login button is inside an iframe, use browser_eval to switch")
- Site-specific selectors or workflows that differ from standard patterns

Knowledge is automatically attached:
- browser_navigate / browser_launch: Full history (up to 20 entries) on first visit to each path
- browser_snapshot: Compact hints (up to 5 entries) when page URL changes

The more you record, the fewer mistakes you repeat. Always check knowledge before trying complex site interactions.`;

const AUTO_LEARN_TOOLS = new Set([
  'browser_navigate', 'browser_back', 'browser_forward',
  'browser_click', 'browser_type', 'browser_select',
  'browser_hover', 'browser_scroll', 'browser_wait', 'browser_wait_for_stable',
  'browser_eval', 'browser_snapshot',
]);

interface ToolResult {
  [key: string]: unknown;
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
  private sessions = new Map<string, ExtensionBridge>();
  private launching = new Set<string>();
  private siteKnowledge = new SiteKnowledge();
  private recentFailures = new Map<string, Set<string>>();
  private knowledgeShownPaths = new Set<string>();
  private lastUrlPerTab = new Map<string, string>(); // "sessionId:tabId" → url
  private lastSnapshot = new Map<string, string>(); // "sessionId:tabId:frameId" → snapshot
  readonly server: Server;

  constructor() {
    this.server = new Server(
      { name: 'aly-browser', version: process.env.npm_package_version || '1.6.0' },
      {
        capabilities: { tools: {} },
        instructions: INSTRUCTIONS,
      },
    );
    this.registerTools();
    this.registerCleanup();
  }

  // ── Session Management ──────────────────────────────────────

  private getSessionId(args: Record<string, unknown>): string {
    return (args.sessionId as string) || 'default';
  }

  private getSession(sessionId: string): ExtensionBridge {
    const bridge = this.sessions.get(sessionId);
    if (!bridge) {
      throw new Error(
        `No browser session "${sessionId}". Call browser_launch with sessionId="${sessionId}" first.`,
      );
    }
    return bridge;
  }

  private getBridge(args: Record<string, unknown>): ExtensionBridge {
    return this.getSession(this.getSessionId(args));
  }

  private requireString(args: Record<string, unknown>, key: string): string {
    const val = args[key];
    if (typeof val !== 'string' || !val) throw new Error(`"${key}" must be a non-empty string`);
    return val;
  }

  private ensureConnected(args: Record<string, unknown>): ExtensionBridge {
    const bridge = this.getBridge(args);
    if (!bridge.isConnected) {
      throw new Error(
        `Session "${this.getSessionId(args)}" is not connected. Call browser_launch first.`,
      );
    }
    return bridge;
  }

  private tabKey(sessionId: string, tabId?: number): string {
    return `${sessionId}:${tabId ?? 0}`;
  }

  // ── Tool Registration ───────────────────────────────────────

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
          const sessionId = this.getSessionId(typedArgs);
          const url = await this.getCurrentUrl(sessionId, typedArgs.tabId as number | undefined);
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
          const sessionId = this.getSessionId(typedArgs);
          const url = await this.getCurrentUrl(sessionId, typedArgs.tabId as number | undefined);
          if (url) this.recordFailure(url, name, message);
        }

        return errorResult(message);
      }
    });
  }

  // ── Tool Router ─────────────────────────────────────────────

  private async handleTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    switch (name) {
      // Browser control
      case 'browser_launch':
        return this.handleLaunch(args);
      case 'browser_navigate':
        return this.handleNavigate(args);
      case 'browser_back':
        return this.handleBack(args);
      case 'browser_forward':
        return this.handleForward(args);
      case 'browser_close':
        return this.handleClose(args);

      // Page reading
      case 'browser_snapshot':
        return this.handleSnapshot(args);
      case 'browser_snapshot_diff':
        return this.handleSnapshotDiff(args);
      case 'browser_html':
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

      // Tabs
      case 'browser_tab_list':
        return this.handleTabList(args);
      case 'browser_tab_new':
        return this.handleTabNew(args);
      case 'browser_tab_close':
        return this.handleTabClose(args);
      case 'browser_tab_switch':
        return this.handleTabSwitch(args);

      // Upload
      case 'browser_upload':
        return this.handleUpload(args);

      // Frames
      case 'browser_frame_list':
        return this.handleFrameList(args);

      // Cookies
      case 'browser_cookie_get':
        return this.handleCookieGet(args);
      case 'browser_cookie_set':
        return this.handleCookieSet(args);
      case 'browser_cookie_delete':
        return this.handleCookieDelete(args);

      // Downloads
      case 'browser_download':
        return this.handleDownload(args);

      // History
      case 'browser_history_search':
        return this.handleHistorySearch(args);

      // Alarms
      case 'browser_alarm_create':
        return this.handleAlarmCreate(args);
      case 'browser_alarm_list':
        return this.handleAlarmList(args);
      case 'browser_alarm_clear':
        return this.handleAlarmClear(args);
      case 'browser_alarm_events':
        return this.handleAlarmEvents(args);

      // Storage
      case 'browser_storage_get':
        return this.handleStorageGet(args);
      case 'browser_storage_set':
        return this.handleStorageSet(args);

      // Notifications
      case 'browser_notify':
        return this.handleNotify(args);

      // Bookmarks
      case 'browser_bookmark_list':
        return this.handleBookmarkList(args);
      case 'browser_bookmark_create':
        return this.handleBookmarkCreate(args);
      case 'browser_bookmark_delete':
        return this.handleBookmarkDelete(args);

      // Sleep
      case 'browser_sleep':
        return this.handleSleep();

      // Performance
      case 'browser_perf_metrics':
        return this.handlePerfMetrics(args);

      // Style Override
      case 'browser_style_override':
        return this.handleStyleOverride(args);

      // Local Storage
      case 'browser_local_storage':
        return this.handleLocalStorage(args);

      // Wait for Text
      case 'browser_wait_for_text':
        return this.handleWaitForText(args);

      // Page Audit
      case 'browser_page_audit':
        return this.handlePageAudit(args);

      // Session Clone
      case 'browser_session_clone':
        return this.handleSessionClone(args);

      // Page Weight
      case 'browser_page_size':
        return this.handlePageSize(args);

      // Cookie Profile
      case 'browser_cookie_export':
        return this.handleCookieExport(args);
      case 'browser_cookie_import':
        return this.handleCookieImport(args);

      // CAPTCHA Detection
      case 'browser_captcha_detect':
        return this.handleCaptchaDetect(args);

      // DOM Observer
      case 'browser_dom_observe':
        return this.handleDomObserve(args);

      // Scroll Map
      case 'browser_scroll_map':
        return this.handleScrollMap(args);

      // Dark Mode
      case 'browser_dark_mode':
        return this.handleDarkMode(args);

      // Viewport
      case 'browser_viewport_test':
        return this.handleViewportTest(args);

      // Page Text
      case 'browser_text_content':
        return this.handleTextContent(args);

      // Data Extraction
      case 'browser_table_extract':
        return this.handleTableExtract(args);

      case 'browser_image_list':
        return this.handleImageList(args);
      case 'browser_link_extract':
        return this.handleLinkExtract(args);

      // Element Inspector
      case 'browser_element_info':
        return this.handleElementInfo(args);

      // SEO
      case 'browser_meta_seo':
        return this.handleMetaSeo(args);

      // Console
      case 'browser_console_log':
        return this.handleConsoleLog(args);

      // Network
      case 'browser_network_log':
        return this.handleNetworkLog(args);

      // Form Automation
      case 'browser_form_fill':
        return this.handleFormFill(args);
      case 'browser_form_detect':
        return this.handleFormDetect(args);

      // Accessibility
      case 'browser_a11y_audit':
        return this.handleA11yAudit(args);

      // Site Knowledge
      case 'browser_learn':
        return this.handleLearn(args);
      case 'browser_get_knowledge':
        return this.handleGetKnowledge(args);

      // Top Sites
      case 'browser_top_sites':
        return this.handleTopSites(args);

      // Clipboard
      case 'browser_clipboard_read':
        return this.handleClipboardRead(args);
      case 'browser_clipboard_write':
        return this.handleClipboardWrite(args);

      // Session Management
      case 'browser_session_list':
        return this.handleSessionList();
      case 'browser_session_close_all':
        return this.handleSessionCloseAll();

      // Screen Tools (standalone)
      case 'screen_capture':
        return this.handleScreenCapture(args);
      case 'screen_click':
        return this.handleScreenClick(args);
      case 'screen_type':
        return this.handleScreenType(args);
      case 'screen_key':
        return this.handleScreenKey(args);
      case 'screen_scroll':
        return this.handleScreenScroll(args);

      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  }

  // ── Browser Control ─────────────────────────────────────────

  private async handleLaunch(args: Record<string, unknown>): Promise<ToolResult> {
    const sessionId = this.getSessionId(args);

    // Prevent concurrent launches for the same session
    if (this.launching.has(sessionId)) {
      return errorResult(`Session "${sessionId}" is already launching. Please wait.`);
    }

    // Reuse existing session if connected
    const existing = this.sessions.get(sessionId);
    if (existing?.isConnected) {
      if (args.url) {
        return this.handleNavigate(args);
      }
      return textResult(`Browser already running (session: ${sessionId}, port: ${existing.port}).`);
    }

    // Clean up stale session
    if (existing) {
      await existing.close().catch(() => {});
      this.sessions.delete(sessionId);
    }

    this.launching.add(sessionId);
    const bridge = new ExtensionBridge(sessionId);
    try {
      await bridge.launch({ url: args.url as string | undefined });
    } catch (err) {
      await bridge.close().catch(() => {});
      this.launching.delete(sessionId);
      throw err;
    }
    this.launching.delete(sessionId);
    this.sessions.set(sessionId, bridge);

    if (args.url) {
      const url = args.url as string;
      const kKey = this.knowledgeKey(url);
      const knowledge = this.siteKnowledge.formatForContext(url);
      const prefix = knowledge ? `${knowledge}\n\n` : '';
      this.knowledgeShownPaths.add(kKey);
      this.lastUrlPerTab.set(this.tabKey(sessionId, 0), url);
      // Wait for page to stabilize after initial navigation
      await bridge.waitForStable({ timeout: 5000, stableMs: 500 }).catch(() => {});
      const snapshot = await bridge.snapshot();
      return textResult(
        `Browser launched → ${url} (session: ${sessionId}, port: ${bridge.port})\n\n${prefix}${snapshot}`,
      );
    }
    return textResult(`Browser launched (session: ${sessionId}, port: ${bridge.port}).`);
  }

  private async handleNavigate(args: Record<string, unknown>): Promise<ToolResult> {
    const sessionId = this.getSessionId(args);
    const bridge = this.ensureConnected(args);
    const url = args.url as string;
    const tabId = args.tabId as number | undefined;
    const kKey = this.knowledgeKey(url);

    let prefix = '';
    if (!this.knowledgeShownPaths.has(kKey)) {
      const knowledge = this.siteKnowledge.formatForContext(url);
      if (knowledge) prefix = `${knowledge}\n\n`;
      this.knowledgeShownPaths.add(kKey);
    }
    this.lastUrlPerTab.set(this.tabKey(sessionId, tabId), url);

    await bridge.navigate(url, tabId);
    await bridge.waitForStable({ timeout: 5000, stableMs: 500, tabId }).catch(() => {});
    const snap = await bridge.snapshot(tabId);
    return textResult(`${prefix}${snap}`);
  }

  private async handleBack(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;
    await bridge.goBack(tabId);
    const snap = await bridge.snapshot(tabId);
    return textResult(snap);
  }

  private async handleForward(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;
    await bridge.goForward(tabId);
    const snap = await bridge.snapshot(tabId);
    return textResult(snap);
  }

  private async handleClose(args: Record<string, unknown>): Promise<ToolResult> {
    const sessionId = this.getSessionId(args);
    const bridge = this.sessions.get(sessionId);
    if (bridge) {
      await bridge.close().catch(() => {});
      this.sessions.delete(sessionId);
    }
    // Clean up tab tracking for this session
    for (const key of this.lastUrlPerTab.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.lastUrlPerTab.delete(key);
      }
    }
    return textResult(`Browser session "${sessionId}" closed.`);
  }

  // ── Page Reading ────────────────────────────────────────────

  private async handleSnapshot(args: Record<string, unknown>): Promise<ToolResult> {
    const sessionId = this.getSessionId(args);
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;
    const frameId = args.frameId as number | undefined;
    const snap = await bridge.snapshot(tabId, frameId);

    const url = await this.getCurrentUrl(sessionId, tabId);
    if (url) {
      const tk = this.tabKey(sessionId, tabId);
      const lastUrl = this.lastUrlPerTab.get(tk);
      if (lastUrl !== url) {
        this.lastUrlPerTab.set(tk, url);
        const kKey = this.knowledgeKey(url);
        if (!this.knowledgeShownPaths.has(kKey) && this.siteKnowledge.hasPath(url)) {
          const hint = this.siteKnowledge.formatCompact(url);
          if (hint) {
            this.knowledgeShownPaths.add(kKey);
            return textResult(`${hint}\n\n${snap}`);
          }
        }
      }
    }

    // Cache snapshot for diff
    const snapKey = `${sessionId}:${tabId ?? 0}:${frameId ?? 0}`;
    this.lastSnapshot.set(snapKey, snap);

    return textResult(snap);
  }

  private async handleSnapshotDiff(args: Record<string, unknown>): Promise<ToolResult> {
    const sessionId = this.getSessionId(args);
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;
    const frameId = args.frameId as number | undefined;
    const snapKey = `${sessionId}:${tabId ?? 0}:${frameId ?? 0}`;

    const newSnap = await bridge.snapshot(tabId, frameId);
    const oldSnap = this.lastSnapshot.get(snapKey);

    // Update cache
    this.lastSnapshot.set(snapKey, newSnap);

    if (!oldSnap) {
      return textResult(`[First snapshot — no previous to diff against]\n\n${newSnap}`);
    }

    const diff = snapshotDiff(oldSnap, newSnap);
    return textResult(diff.summary);
  }

  private async handleHTML(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;
    const frameId = args.frameId as number | undefined;
    return textResult(await bridge.getHTML(tabId, frameId));
  }

  private async handleEval(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const expr = args.expression as string;
    const tabId = args.tabId as number | undefined;
    const result = await bridge.evaluate(expr, tabId);
    return textResult(
      typeof result === 'string' ? result : JSON.stringify(result, null, 2),
    );
  }

  // ── Page Interaction ────────────────────────────────────────

  private async handleClick(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const ref = this.requireString(args, 'ref');
    const tabId = args.tabId as number | undefined;
    const frameId = args.frameId as number | undefined;
    await bridge.click(ref, tabId, frameId);
    const snap = await bridge.snapshot(tabId, frameId);
    return textResult(`Clicked ${ref}\n\n${snap}`);
  }

  private async handleType(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const ref = this.requireString(args, 'ref');
    const text = this.requireString(args, 'text');
    const clear = (args.clear as boolean) ?? false;
    const tabId = args.tabId as number | undefined;
    const frameId = args.frameId as number | undefined;
    await bridge.type(ref, text, { clear, tabId, frameId });
    const snap = await bridge.snapshot(tabId, frameId);
    return textResult(`Typed "${text}" → ${ref}\n\n${snap}`);
  }

  private async handleSelect(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const ref = this.requireString(args, 'ref');
    const value = this.requireString(args, 'value');
    const tabId = args.tabId as number | undefined;
    const frameId = args.frameId as number | undefined;
    await bridge.selectOption(ref, value, tabId, frameId);
    const snap = await bridge.snapshot(tabId, frameId);
    return textResult(`Selected "${value}" in ${ref}\n\n${snap}`);
  }

  private async handleHover(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const ref = this.requireString(args, 'ref');
    const tabId = args.tabId as number | undefined;
    const frameId = args.frameId as number | undefined;
    await bridge.hover(ref, tabId, frameId);
    const snap = await bridge.snapshot(tabId, frameId);
    return textResult(`Hovered ${ref}\n\n${snap}`);
  }

  private async handleScroll(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const x = (args.x as number) ?? 0;
    const y = (args.y as number) ?? 0;
    const tabId = args.tabId as number | undefined;
    const frameId = args.frameId as number | undefined;
    await bridge.scrollBy({ x, y, tabId, frameId });
    const snap = await bridge.snapshot(tabId, frameId);
    return textResult(`Scrolled (${x}, ${y})\n\n${snap}`);
  }

  private async handleWait(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const selector = this.requireString(args, 'selector');
    const timeout = args.timeout as number | undefined;
    const hidden = (args.hidden as boolean) ?? false;
    const tabId = args.tabId as number | undefined;
    const frameId = args.frameId as number | undefined;
    await bridge.waitForSelector(selector, { timeout, hidden, tabId, frameId });
    return textResult(hidden
      ? `Element "${selector}" disappeared.`
      : `Element "${selector}" found.`);
  }

  private async handleWaitForStable(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const timeout = args.timeout as number | undefined;
    const stableMs = 500;
    const tabId = args.tabId as number | undefined;
    const frameId = args.frameId as number | undefined;
    await bridge.waitForStable({ timeout, stableMs, tabId, frameId });
    return textResult('DOM stabilized.');
  }

  private async handleUpload(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const filePath = this.requireString(args, 'filePath');
    const ref = args.ref as string | undefined;
    const tabId = args.tabId as number | undefined;
    const frameId = args.frameId as number | undefined;
    const result = await bridge.upload(filePath, { ref, tabId, frameId });
    return jsonResult(result);
  }

  private async handleFrameList(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;
    const maxDepth = (args.depth as number) ?? 10;
    const frames = (await bridge.frameList(tabId)) as Array<{ frameId: number; parentFrameId: number; url: string }>;

    // Compute depth for each frame based on parent chain
    const depthMap = new Map<number, number>();
    depthMap.set(0, 0); // main frame
    // Build parent lookup and compute depths
    const parentMap = new Map<number, number>();
    for (const f of frames) parentMap.set(f.frameId, f.parentFrameId);
    function getDepth(frameId: number): number {
      if (depthMap.has(frameId)) return depthMap.get(frameId)!;
      const parentId = parentMap.get(frameId);
      const d = parentId !== undefined ? getDepth(parentId) + 1 : 0;
      depthMap.set(frameId, d);
      return d;
    }
    const result = frames
      .map((f) => ({ ...f, depth: getDepth(f.frameId) }))
      .filter((f) => f.depth <= maxDepth);

    return jsonResult(result);
  }

  // ── Tab Management ───────────────────────────────────────────

  private async handleTabList(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    return jsonResult(await bridge.tabList());
  }

  private async handleTabNew(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const result = await bridge.tabNew(args.url as string | undefined);
    return jsonResult(result);
  }

  private async handleTabClose(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    await bridge.tabClose(args.tabId as number | undefined);
    return textResult('Tab closed.');
  }

  private async handleTabSwitch(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    await bridge.tabSwitch(args.tabId as number);
    return textResult(`Switched to tab ${args.tabId}.`);
  }

  // ── Cookies ──────────────────────────────────────────────────

  private async handleCookieGet(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const cookies = await bridge.cookieGet(
      args.url as string,
      args.name as string | undefined,
    );
    return jsonResult(cookies);
  }

  private async handleCookieSet(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const { sessionId: _, tabId: __, ...cookieArgs } = args;
    await bridge.cookieSet(cookieArgs);
    return textResult('Cookie set.');
  }

  private async handleCookieDelete(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    await bridge.cookieDelete(args.url as string, args.name as string);
    return textResult('Cookie deleted.');
  }

  // ── Downloads ────────────────────────────────────────────────

  private async handleDownload(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const result = await bridge.download(
      args.url as string,
      args.filename as string | undefined,
    );
    return jsonResult(result);
  }

  // ── History ──────────────────────────────────────────────────

  private async handleHistorySearch(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const results = await bridge.historySearch(
      args.query as string | undefined,
      args.maxResults as number | undefined,
    );
    return jsonResult(results);
  }

  // ── Alarms ───────────────────────────────────────────────────

  private async handleAlarmCreate(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const result = await bridge.alarmCreate(args.name as string, {
      delayInMinutes: args.delayInMinutes,
      periodInMinutes: args.periodInMinutes,
    });
    return jsonResult(result);
  }

  private async handleAlarmList(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    return jsonResult(await bridge.alarmList());
  }

  private async handleAlarmClear(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    await bridge.alarmClear(args.name as string | undefined);
    return textResult('Alarm cleared.');
  }

  private async handleAlarmEvents(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    return jsonResult(await bridge.alarmEvents());
  }

  // ── Storage ──────────────────────────────────────────────────

  private async handleStorageGet(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const data = await bridge.storageGet(args.keys as string[] | undefined);
    return jsonResult(data);
  }

  private async handleStorageSet(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    await bridge.storageSet(args.data as Record<string, unknown>);
    return textResult('Storage updated.');
  }

  // ── Notifications ────────────────────────────────────────────

  private async handleNotify(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const result = await bridge.notify(
      args.title as string,
      args.message as string,
    );
    return jsonResult(result);
  }

  // ── Bookmarks ──────────────────────────────────────────────

  private async handleBookmarkList(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const results = await bridge.bookmarkList(args.query as string | undefined);
    return jsonResult(results);
  }

  private async handleBookmarkCreate(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const result = await bridge.bookmarkCreate(
      args.title as string,
      args.url as string,
      args.parentId as string | undefined,
    );
    return jsonResult(result);
  }

  private async handleBookmarkDelete(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    await bridge.bookmarkDelete(args.id as string);
    return textResult('Bookmark deleted.');
  }

  // ── Top Sites ──────────────────────────────────────────────

  private async handleTopSites(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    return jsonResult(await bridge.topSites());
  }

  // ── Clipboard ──────────────────────────────────────────────

  private async handleClipboardRead(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;
    const text = await bridge.clipboardRead(tabId);
    return textResult(typeof text === 'string' ? text : JSON.stringify(text));
  }

  private async handleClipboardWrite(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;
    await bridge.clipboardWrite(args.text as string, tabId);
    return textResult('Clipboard updated.');
  }

  // ── Sleep ──────────────────────────────────────────────────

  private async handleSleep(): Promise<ToolResult> {
    await new Promise((r) => setTimeout(r, 1000));
    return textResult('Waited 1 second.');
  }

  // ── Performance ────────────────────────────────────────────

  private async handlePerfMetrics(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;

    const metrics = await bridge.evaluate(`(() => {
      const t = performance.timing;
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const resources = performance.getEntriesByType('resource');
      return JSON.stringify({
        timing: {
          domContentLoaded: t.domContentLoadedEventEnd - t.navigationStart,
          load: t.loadEventEnd - t.navigationStart,
          ttfb: t.responseStart - t.navigationStart,
          domInteractive: t.domInteractive - t.navigationStart,
          domComplete: t.domComplete - t.navigationStart,
        },
        dom: {
          elements: document.querySelectorAll('*').length,
          depth: (() => { let d=0,max=0; const walk=(el,lvl)=>{if(lvl>max)max=lvl; for(const c of el.children)walk(c,lvl+1);}; walk(document.body,0); return max; })(),
          scripts: document.scripts.length,
          stylesheets: document.styleSheets.length,
          images: document.images.length,
          forms: document.forms.length,
          iframes: document.querySelectorAll('iframe').length,
        },
        resources: {
          total: resources.length,
          totalSize: resources.reduce((s,r) => s + (r.transferSize || 0), 0),
          byType: resources.reduce((acc, r) => {
            const ext = r.name.split('.').pop()?.split('?')[0] || 'other';
            acc[ext] = (acc[ext] || 0) + 1;
            return acc;
          }, {}),
        },
        url: location.href,
        title: document.title,
      });
    })()`, tabId);

    const data = typeof metrics === 'string' ? JSON.parse(metrics) : metrics;

    const lines = [
      `[Performance Metrics] ${data.title}`,
      `URL: ${data.url}`,
      '',
      '── Timing ──',
      `  TTFB: ${data.timing.ttfb}ms`,
      `  DOM Interactive: ${data.timing.domInteractive}ms`,
      `  DOM Content Loaded: ${data.timing.domContentLoaded}ms`,
      `  DOM Complete: ${data.timing.domComplete}ms`,
      `  Full Load: ${data.timing.load}ms`,
      '',
      '── DOM ──',
      `  Elements: ${data.dom.elements}`,
      `  Max Depth: ${data.dom.depth}`,
      `  Scripts: ${data.dom.scripts}`,
      `  Stylesheets: ${data.dom.stylesheets}`,
      `  Images: ${data.dom.images}`,
      `  Forms: ${data.dom.forms}`,
      `  Iframes: ${data.dom.iframes}`,
      '',
      '── Resources ──',
      `  Total: ${data.resources.total}`,
      `  Transfer Size: ${(data.resources.totalSize / 1024).toFixed(1)} KB`,
    ];

    return textResult(lines.join('\n'));
  }

  // ── Style Override ────────────────────────────────────────

  private async handleStyleOverride(args: Record<string, unknown>): Promise<ToolResult> {
    const action = (args.action as string) || 'inject';

    if (action === 'inject' && !args.css) return errorResult('"css" is required for inject action');
    if (action === 'remove' && !args.id) return errorResult('"id" is required for remove action');

    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;

    if (action === 'inject') {
      const css = args.css as string;
      const cssJson = JSON.stringify(css);
      const result = await bridge.evaluate(`(() => {
        const id = 'aly-style-' + Date.now();
        const style = document.createElement('style');
        style.id = id;
        style.setAttribute('data-aly-override', 'true');
        style.textContent = ${cssJson};
        document.head.appendChild(style);
        return JSON.stringify({ id, length: ${cssJson}.length });
      })()`, tabId);
      const data = typeof result === 'string' ? JSON.parse(result) : result;
      return textResult(`[Style] Injected "${data.id}" (${data.length} chars)`);
    }

    if (action === 'remove') {
      const id = args.id as string;
      await bridge.evaluate(`document.getElementById(${JSON.stringify(id)})?.remove()`, tabId);
      return textResult(`[Style] Removed "${id}"`);
    }

    // list
    const result = await bridge.evaluate(`(() => {
      const styles = [...document.querySelectorAll('style[data-aly-override]')];
      return JSON.stringify(styles.map(s => ({ id: s.id, length: (s.textContent || '').length, preview: (s.textContent || '').slice(0, 80) })));
    })()`, tabId);
    const styles = typeof result === 'string' ? JSON.parse(result) : result;

    if (styles.length === 0) return textResult('[Style] No active overrides');
    const lines = [`[Style] ${styles.length} active override(s)`];
    for (const s of styles) {
      lines.push(`  ${s.id} (${s.length} chars): ${s.preview}`);
    }
    return textResult(lines.join('\n'));
  }

  // ── Local Storage ─────────────────────────────────────────

  private async handleLocalStorage(args: Record<string, unknown>): Promise<ToolResult> {
    const action = (args.action as string) || 'list';
    const key = args.key as string | undefined;
    const value = args.value as string | undefined;

    if (action === 'set' && (!key || value === undefined)) {
      return errorResult('"key" and "value" required for set action');
    }
    if (action === 'delete' && !key) {
      return errorResult('"key" required for delete action');
    }

    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;

    const result = await bridge.evaluate(`(() => {
      const action = ${JSON.stringify(action)};
      const key = ${JSON.stringify(key || null)};
      const value = ${JSON.stringify(value || null)};

      if (action === 'set') {
        localStorage.setItem(key, value);
        return JSON.stringify({ ok: true, key, size: value.length });
      }
      if (action === 'delete') {
        localStorage.removeItem(key);
        return JSON.stringify({ ok: true, key });
      }
      if (action === 'clear') {
        const count = localStorage.length;
        localStorage.clear();
        return JSON.stringify({ ok: true, cleared: count });
      }
      if (action === 'get' && key) {
        const val = localStorage.getItem(key);
        return JSON.stringify({ key, value: val, exists: val !== null });
      }
      // list or get-all
      const items = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k);
        items.push({ key: k, size: (v || '').length, preview: (v || '').slice(0, 80) });
      }
      return JSON.stringify({ count: items.length, items });
    })()`, tabId);

    const data = typeof result === 'string' ? JSON.parse(result) : result;

    if (data.ok) {
      if (action === 'set') return textResult(`[localStorage] Set "${data.key}" (${data.size} chars)`);
      if (action === 'delete') return textResult(`[localStorage] Deleted "${data.key}"`);
      if (action === 'clear') return textResult(`[localStorage] Cleared ${data.cleared} items`);
    }
    if (data.exists !== undefined) {
      return data.exists
        ? textResult(`[localStorage] "${data.key}" = ${(data.value || '').slice(0, 200)}`)
        : textResult(`[localStorage] "${data.key}" not found`);
    }

    // list
    const lines = [`[localStorage] ${data.count} items`];
    for (const item of data.items.slice(0, 20)) {
      lines.push(`  ${item.key} (${item.size} chars): ${item.preview}`);
    }
    if (data.count > 20) lines.push(`  ... +${data.count - 20} more`);
    return textResult(lines.join('\n'));
  }

  // ── Wait for Text ─────────────────────────────────────────

  private async handleWaitForText(args: Record<string, unknown>): Promise<ToolResult> {
    const text = this.requireString(args, 'text');
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;
    const hidden = (args.hidden as boolean) ?? false;
    const timeout = (args.timeout as number) ?? 10000;

    const textJson = JSON.stringify(text);
    const result = await bridge.evaluate(`new Promise((resolve) => {
      const text = ${textJson};
      const hidden = ${hidden};
      const timeout = ${timeout};
      const start = Date.now();

      const check = () => {
        const found = document.body?.textContent?.includes(text) || false;
        const done = hidden ? !found : found;
        if (done) {
          resolve(JSON.stringify({ found: !hidden, elapsed: Date.now() - start }));
          return;
        }
        if (Date.now() - start > timeout) {
          resolve(JSON.stringify({ found: hidden ? true : false, elapsed: Date.now() - start, timedOut: true }));
          return;
        }
        setTimeout(check, 200);
      };
      check();
    })`, tabId);

    const data = typeof result === 'string' ? JSON.parse(result) : result;

    if (data.timedOut) {
      return errorResult(
        hidden
          ? `Text "${text}" still present after ${data.elapsed}ms (timeout)`
          : `Text "${text}" not found after ${data.elapsed}ms (timeout)`,
      );
    }

    return textResult(
      hidden
        ? `Text "${text}" disappeared after ${data.elapsed}ms.`
        : `Text "${text}" found after ${data.elapsed}ms.`,
    );
  }

  // ── Page Audit (Unified) ──────────────────────────────────

  private async handlePageAudit(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;

    const result = await bridge.evaluate(`(() => {
      const issues = { perf: [], a11y: [], seo: [], weight: [] };

      // Performance
      const t = performance.timing;
      const load = t.loadEventEnd - t.navigationStart;
      const ttfb = t.responseStart - t.navigationStart;
      if (load > 3000) issues.perf.push('Slow page load: ' + load + 'ms (>3s)');
      if (ttfb > 600) issues.perf.push('Slow TTFB: ' + ttfb + 'ms (>600ms)');
      const domElements = document.querySelectorAll('*').length;
      if (domElements > 1500) issues.perf.push('Large DOM: ' + domElements + ' elements (>1500)');

      // Accessibility
      document.querySelectorAll('img').forEach(img => {
        if (!img.hasAttribute('alt')) issues.a11y.push('Image missing alt: ' + (img.src || '').slice(0, 60));
      });
      document.querySelectorAll('a').forEach(a => {
        if (!(a.textContent || '').trim() && !a.getAttribute('aria-label') && !a.querySelector('img[alt]'))
          issues.a11y.push('Empty link: ' + (a.href || '').slice(0, 60));
      });
      if (!document.documentElement.hasAttribute('lang')) issues.a11y.push('Missing lang attribute');
      if (!document.querySelector('h1')) issues.a11y.push('Missing h1 heading');

      // SEO
      if (!document.title) issues.seo.push('Missing page title');
      else if (document.title.length > 60) issues.seo.push('Title too long: ' + document.title.length + ' chars');
      const desc = document.querySelector('meta[name="description"]');
      if (!desc) issues.seo.push('Missing meta description');
      if (!document.querySelector('link[rel="canonical"]')) issues.seo.push('Missing canonical URL');
      if (!document.querySelector('meta[property="og:title"]')) issues.seo.push('Missing Open Graph title');

      // Weight
      const resources = performance.getEntriesByType('resource');
      const totalSize = resources.reduce((s,r) => s + (r.transferSize || 0), 0);
      if (totalSize > 2 * 1024 * 1024) issues.weight.push('Heavy page: ' + Math.round(totalSize/1024) + 'KB (>2MB)');
      const bigResources = resources.filter(r => (r.transferSize || 0) > 500 * 1024);
      bigResources.forEach(r => issues.weight.push('Large resource: ' + Math.round((r.transferSize||0)/1024) + 'KB ' + r.name.slice(0, 60)));

      const totalIssues = issues.perf.length + issues.a11y.length + issues.seo.length + issues.weight.length;
      const score = Math.max(0, 100 - totalIssues * 5);

      return JSON.stringify({
        score, url: location.href, title: document.title,
        counts: { perf: issues.perf.length, a11y: issues.a11y.length, seo: issues.seo.length, weight: issues.weight.length, total: totalIssues },
        issues,
        metrics: { load, ttfb, domElements, totalSize, resourceCount: resources.length },
      });
    })()`, tabId);

    const data = typeof result === 'string' ? JSON.parse(result) : result;
    const grade = data.score >= 90 ? 'A' : data.score >= 70 ? 'B' : data.score >= 50 ? 'C' : data.score >= 30 ? 'D' : 'F';

    const lines = [
      `[Page Audit] Score: ${data.score}/100 (${grade}) — ${data.title}`,
      `  URL: ${data.url}`,
      `  Issues: ${data.counts.total} (Perf: ${data.counts.perf}, A11y: ${data.counts.a11y}, SEO: ${data.counts.seo}, Weight: ${data.counts.weight})`,
      `  Load: ${data.metrics.load}ms, TTFB: ${data.metrics.ttfb}ms, DOM: ${data.metrics.domElements}, Resources: ${data.metrics.resourceCount}`,
    ];

    for (const [cat, list] of Object.entries(data.issues) as [string, string[]][]) {
      if (list.length > 0) {
        lines.push('', `── ${cat.toUpperCase()} ──`);
        for (const i of list.slice(0, 5)) lines.push(`  ⚠ ${i}`);
        if (list.length > 5) lines.push(`  ... +${list.length - 5} more`);
      }
    }

    if (data.counts.total === 0) lines.push('', '✓ No issues found — great page quality!');

    return textResult(lines.join('\n'));
  }

  // ── Session Clone ─────────────────────────────────────────

  private async handleSessionClone(args: Record<string, unknown>): Promise<ToolResult> {
    const sourceId = (args.sourceSessionId as string) || 'default';
    const targetId = args.targetSessionId as string;
    if (!targetId) return errorResult('"targetSessionId" is required');

    const source = this.sessions.get(sourceId);
    if (!source?.isConnected) {
      return errorResult(`Source session "${sourceId}" not found or not connected`);
    }

    // Check target doesn't already exist
    if (this.sessions.has(targetId)) {
      return errorResult(`Target session "${targetId}" already exists`);
    }

    // Launch target session
    const { ExtensionBridge } = await import('../extension/bridge');
    const target = new ExtensionBridge(targetId);
    try {
      await target.launch({ url: args.url as string | undefined });
    } catch (err) {
      await target.close().catch(() => {});
      throw err;
    }
    this.sessions.set(targetId, target);

    // Copy cookies from source — get all cookies via evaluate
    let copiedCount = 0;
    try {
      const cookiesRaw = await source.evaluate('JSON.stringify(document.cookie)');
      const url = await source.evaluate('location.href');
      if (typeof url === 'string') {
        const allCookies = await source.cookieGet(url);
        if (Array.isArray(allCookies)) {
          for (const cookie of allCookies) {
            try {
              await target.cookieSet(cookie as Record<string, unknown>);
              copiedCount++;
            } catch {}
          }
        }
      }
    } catch {}

    return textResult(
      `[Session Clone] "${sourceId}" → "${targetId}"\n` +
      `  Cookies copied: ${copiedCount}\n` +
      `  Target port: ${target.port}\n` +
      (args.url ? `  Navigated to: ${args.url}` : '  Ready for navigation'),
    );
  }

  // ── Page Weight ───────────────────────────────────────────

  private async handlePageSize(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;

    const result = await bridge.evaluate(`(() => {
      const entries = performance.getEntriesByType('resource');
      const byType = {};
      let totalSize = 0;
      const heaviest = [];

      for (const e of entries) {
        const size = e.transferSize || 0;
        totalSize += size;
        const ext = e.name.split('/').pop()?.split('?')[0]?.split('.').pop() || 'other';
        const type = e.initiatorType || 'other';
        const cat = type === 'img' ? 'images' : type === 'script' ? 'scripts' : type === 'css' || type === 'link' ? 'stylesheets' : ext === 'woff2' || ext === 'woff' || ext === 'ttf' ? 'fonts' : 'other';
        byType[cat] = (byType[cat] || 0) + size;
        heaviest.push({ url: e.name.slice(0, 120), size, type: cat });
      }

      heaviest.sort((a, b) => b.size - a.size);
      const htmlSize = new Blob([document.documentElement.outerHTML]).size;
      const inlineScripts = [...document.querySelectorAll('script:not([src])')].reduce((s, el) => s + (el.textContent || '').length, 0);
      const inlineStyles = [...document.querySelectorAll('style')].reduce((s, el) => s + (el.textContent || '').length, 0);

      return JSON.stringify({
        totalTransfer: totalSize,
        htmlSize,
        inlineJS: inlineScripts,
        inlineCSS: inlineStyles,
        byCategory: byType,
        resourceCount: entries.length,
        heaviest: heaviest.slice(0, 10),
      });
    })()`, tabId);

    const data = typeof result === 'string' ? JSON.parse(result) : result;
    const fmt = (b: number) => b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b > 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`;

    const lines = [
      `[Page Size] Total transfer: ${fmt(data.totalTransfer)} (${data.resourceCount} resources)`,
      `  HTML: ${fmt(data.htmlSize)}`,
      `  Inline JS: ${fmt(data.inlineJS)}`,
      `  Inline CSS: ${fmt(data.inlineCSS)}`,
      '',
      '── By Category ──',
    ];
    for (const [cat, size] of Object.entries(data.byCategory).sort((a, b) => (b[1] as number) - (a[1] as number))) {
      lines.push(`  ${cat}: ${fmt(size as number)}`);
    }
    if (data.heaviest.length > 0) {
      lines.push('', '── Heaviest Resources ──');
      for (const h of data.heaviest.slice(0, 5)) {
        lines.push(`  ${fmt(h.size)} [${h.type}] ${h.url.slice(0, 80)}`);
      }
    }

    return textResult(lines.join('\n'));
  }

  // ── Cookie Profile ────────────────────────────────────────

  private async handleCookieExport(args: Record<string, unknown>): Promise<ToolResult> {
    const url = this.requireString(args, 'url');
    const bridge = this.ensureConnected(args);
    const cookies = await bridge.cookieGet(url);
    const cookieArr = Array.isArray(cookies) ? cookies : [];
    return jsonResult({ url, count: cookieArr.length, cookies: cookieArr });
  }

  private async handleCookieImport(args: Record<string, unknown>): Promise<ToolResult> {
    if (!Array.isArray(args.cookies)) {
      return errorResult('"cookies" must be an array of cookie objects');
    }
    const cookies = args.cookies as Array<Record<string, unknown>>;
    const bridge = this.ensureConnected(args);
    let imported = 0;
    let failed = 0;
    for (const cookie of cookies) {
      try {
        await bridge.cookieSet(cookie);
        imported++;
      } catch {
        failed++;
      }
    }
    return textResult(`[Cookie Import] ${imported} imported, ${failed} failed (${cookies.length} total)`);
  }

  // ── CAPTCHA Detection ─────────────────────────────────────

  private async handleCaptchaDetect(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;

    const result = await bridge.evaluate(`(() => {
      const detections = [];

      // reCAPTCHA v2 (checkbox)
      const recaptchaV2 = document.querySelector('.g-recaptcha, [data-sitekey], iframe[src*="recaptcha"]');
      if (recaptchaV2) detections.push({ type: 'reCAPTCHA v2', element: recaptchaV2.tagName.toLowerCase(), visible: recaptchaV2.offsetParent !== null });

      // reCAPTCHA v3 (invisible)
      if (document.querySelector('script[src*="recaptcha/api.js?render="]') || window.grecaptcha) {
        detections.push({ type: 'reCAPTCHA v3', element: 'script', visible: false });
      }

      // hCaptcha
      const hcaptcha = document.querySelector('.h-captcha, iframe[src*="hcaptcha"]');
      if (hcaptcha) detections.push({ type: 'hCaptcha', element: hcaptcha.tagName.toLowerCase(), visible: hcaptcha.offsetParent !== null });

      // Cloudflare Turnstile
      const turnstile = document.querySelector('.cf-turnstile, iframe[src*="challenges.cloudflare.com"]');
      if (turnstile) detections.push({ type: 'Cloudflare Turnstile', element: turnstile.tagName.toLowerCase(), visible: turnstile.offsetParent !== null });

      // Cloudflare challenge page
      if (document.title.includes('Just a moment') || document.querySelector('#challenge-running, #challenge-stage')) {
        detections.push({ type: 'Cloudflare Challenge Page', element: 'page', visible: true, blocking: true });
      }

      // Generic challenge indicators
      const bodyText = document.body?.textContent?.toLowerCase() || '';
      if (bodyText.includes('verify you are human') || bodyText.includes('prove you are not a robot')) {
        detections.push({ type: 'Generic Challenge', element: 'text', visible: true });
      }

      // PerimeterX / DataDome
      if (document.querySelector('iframe[src*="perimeterx"], iframe[src*="datadome"]')) {
        detections.push({ type: 'Bot Protection (PerimeterX/DataDome)', element: 'iframe', visible: true });
      }

      return JSON.stringify({ found: detections.length > 0, detections, url: location.href });
    })()`, tabId);

    const data = typeof result === 'string' ? JSON.parse(result) : result;

    if (!data.found) {
      return textResult(`[CAPTCHA] No CAPTCHA detected on ${data.url}`);
    }

    const lines = [`[CAPTCHA] ${data.detections.length} detection(s) on ${data.url}`];
    for (const d of data.detections) {
      const vis = d.visible ? 'visible' : 'hidden';
      const block = d.blocking ? ' [BLOCKING]' : '';
      lines.push(`  ${d.type} (${d.element}, ${vis})${block}`);
    }

    return textResult(lines.join('\n'));
  }

  // ── DOM Observer ──────────────────────────────────────────

  private async handleDomObserve(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;
    const action = (args.action as string) || 'read';

    const result = await bridge.evaluate(`(() => {
      const action = ${JSON.stringify(action)};

      if (action === 'start') {
        if (window.__alyDomObserver) {
          return JSON.stringify({ status: 'already_running', changes: window.__alyDomChanges?.length || 0 });
        }
        window.__alyDomChanges = [];
        const maxChanges = 500;
        window.__alyDomObserver = new MutationObserver(mutations => {
          for (const m of mutations) {
            if (window.__alyDomChanges.length >= maxChanges) window.__alyDomChanges.shift();
            const entry = { type: m.type, ts: Date.now() };
            if (m.type === 'childList') {
              entry.added = m.addedNodes.length;
              entry.removed = m.removedNodes.length;
              entry.target = (m.target.tagName || '').toLowerCase() + (m.target.id ? '#' + m.target.id : '');
            } else if (m.type === 'attributes') {
              entry.attr = m.attributeName;
              entry.target = (m.target.tagName || '').toLowerCase() + (m.target.id ? '#' + m.target.id : '');
            } else if (m.type === 'characterData') {
              entry.target = (m.target.parentElement?.tagName || '').toLowerCase();
            }
            window.__alyDomChanges.push(entry);
          }
        });
        window.__alyDomObserver.observe(document.body, {
          childList: true, subtree: true, attributes: true, characterData: true,
        });
        return JSON.stringify({ status: 'started' });
      }

      if (action === 'stop') {
        if (window.__alyDomObserver) {
          window.__alyDomObserver.disconnect();
          window.__alyDomObserver = null;
        }
        const changes = window.__alyDomChanges || [];
        window.__alyDomChanges = null;
        return JSON.stringify({ status: 'stopped', totalChanges: changes.length });
      }

      // read
      const changes = window.__alyDomChanges || [];
      window.__alyDomChanges = [];
      return JSON.stringify({
        status: window.__alyDomObserver ? 'observing' : 'not_started',
        changes: changes.slice(-50),
        total: changes.length,
      });
    })()`, tabId);

    const data = typeof result === 'string' ? JSON.parse(result) : result;

    if (data.status === 'started') {
      return textResult('[DOM Observer] Started. Use action="read" to get changes, "stop" to end.');
    }
    if (data.status === 'already_running') {
      return textResult(`[DOM Observer] Already running. ${data.changes} changes buffered.`);
    }
    if (data.status === 'stopped') {
      return textResult(`[DOM Observer] Stopped. ${data.totalChanges} total changes recorded.`);
    }
    if (data.status === 'not_started') {
      return textResult('[DOM Observer] Not started. Use action="start" first.');
    }

    // observing — show changes
    const lines = [`[DOM Observer] ${data.total} changes (showing last ${data.changes.length})`];
    for (const c of data.changes.slice(-20)) {
      if (c.type === 'childList') {
        lines.push(`  [nodes] +${c.added}/-${c.removed} in ${c.target}`);
      } else if (c.type === 'attributes') {
        lines.push(`  [attr] ${c.attr} on ${c.target}`);
      } else {
        lines.push(`  [text] in ${c.target}`);
      }
    }
    if (data.total > 20) lines.push(`  ... ${data.total - 20} more`);

    return textResult(lines.join('\n'));
  }

  // ── Scroll Map ────────────────────────────────────────────

  private async handleScrollMap(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;
    const numSections = (args.sections as number) ?? 5;

    const result = await bridge.evaluate(`(() => {
      const docH = document.documentElement.scrollHeight;
      const vw = window.innerWidth;
      const n = ${numSections};
      const sectionH = docH / n;
      const sections = [];

      for (let i = 0; i < n; i++) {
        const top = i * sectionH;
        const bottom = top + sectionH;
        let elements = 0, interactive = 0, images = 0, textLen = 0;

        document.querySelectorAll('*').forEach(el => {
          const rect = el.getBoundingClientRect();
          const absTop = rect.top + window.scrollY;
          const absBottom = absTop + rect.height;
          if (absBottom < top || absTop > bottom) return;

          elements++;
          const tag = el.tagName.toLowerCase();
          if (['a','button','input','select','textarea'].includes(tag)) interactive++;
          if (tag === 'img') images++;
          if (['p','span','h1','h2','h3','h4','h5','h6','li','td','th'].includes(tag)) {
            textLen += (el.textContent || '').length;
          }
        });

        sections.push({
          range: Math.round(top) + '-' + Math.round(bottom) + 'px',
          pct: Math.round((i/n)*100) + '-' + Math.round(((i+1)/n)*100) + '%',
          elements, interactive, images,
          textDensity: textLen > 10000 ? 'high' : textLen > 3000 ? 'medium' : 'low',
          textChars: textLen,
        });
      }

      return JSON.stringify({ pageHeight: docH, viewportHeight: window.innerHeight, sections });
    })()`, tabId);

    const data = typeof result === 'string' ? JSON.parse(result) : result;
    const lines = [
      `[Scroll Map] ${data.pageHeight}px page, ${data.viewportHeight}px viewport, ${numSections} sections`,
      '',
    ];

    for (const s of data.sections) {
      const bar = s.textDensity === 'high' ? '████' : s.textDensity === 'medium' ? '██' : '█';
      lines.push(`  ${s.pct.padEnd(10)} ${bar} ${s.elements} els, ${s.interactive} interactive, ${s.images} imgs, ${s.textChars} chars`);
    }

    return textResult(lines.join('\n'));
  }

  // ── Dark Mode ─────────────────────────────────────────────

  private async handleDarkMode(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;
    const action = (args.action as string) || 'detect';

    if (action === 'dark' || action === 'light') {
      // Emulate color scheme by injecting a meta tag + overriding matchMedia
      await bridge.evaluate(`(() => {
        // Remove existing override
        document.querySelector('meta[name="color-scheme"][data-aly]')?.remove();
        const meta = document.createElement('meta');
        meta.name = 'color-scheme';
        meta.content = '${action}';
        meta.setAttribute('data-aly', 'true');
        document.head.appendChild(meta);
        // Also set data attribute for CSS that reads it
        document.documentElement.setAttribute('data-theme', '${action}');
        document.documentElement.style.colorScheme = '${action}';
      })()`, tabId);
    }

    const result = await bridge.evaluate(`(() => {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      const cs = getComputedStyle(document.documentElement);
      const bg = cs.backgroundColor;
      const fg = cs.color;
      // Detect if background is dark
      const parseColor = (c) => {
        const m = c.match(/\\d+/g);
        return m ? m.map(Number) : [255,255,255];
      };
      const [r,g,b] = parseColor(bg);
      const luminance = (0.299*r + 0.587*g + 0.114*b) / 255;
      const isDarkBg = luminance < 0.5;

      // Check for dark mode CSS rules
      const hasDarkMediaQuery = [...document.styleSheets].some(ss => {
        try {
          return [...ss.cssRules].some(r => r.media?.mediaText?.includes('prefers-color-scheme'));
        } catch { return false; }
      });

      return JSON.stringify({
        systemPreference: prefersDark ? 'dark' : 'light',
        pageBackground: isDarkBg ? 'dark' : 'light',
        backgroundColor: bg,
        textColor: fg,
        respectsPreference: hasDarkMediaQuery,
        colorSchemeAttr: document.documentElement.style.colorScheme || cs.colorScheme || 'auto',
        dataTheme: document.documentElement.getAttribute('data-theme') || null,
      });
    })()`, tabId);

    const data = typeof result === 'string' ? JSON.parse(result) : result;
    const lines = [
      `[Dark Mode] ${action === 'detect' ? 'Detection' : 'Emulation → ' + action}`,
      `  System Preference: ${data.systemPreference}`,
      `  Page Background: ${data.pageBackground} (${data.backgroundColor})`,
      `  Text Color: ${data.textColor}`,
      `  Respects prefers-color-scheme: ${data.respectsPreference ? 'Yes' : 'No'}`,
      `  color-scheme: ${data.colorSchemeAttr}`,
      `  data-theme: ${data.dataTheme || '(none)'}`,
    ];

    return textResult(lines.join('\n'));
  }

  // ── Viewport ──────────────────────────────────────────────

  private async handleViewportTest(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;

    const presets: Record<string, [number, number]> = {
      mobile: [375, 667],
      tablet: [768, 1024],
      desktop: [1280, 720],
      wide: [1920, 1080],
    };

    const preset = args.preset as string | undefined;
    const width = (args.width as number) ?? (preset ? presets[preset]?.[0] : undefined);
    const height = (args.height as number) ?? (preset ? presets[preset]?.[1] : undefined);

    // If width/height specified, resize viewport via evaluate
    if (width && height) {
      await bridge.evaluate(
        `window.resizeTo(${width}, ${height}); void 0;`,
        tabId,
      );
      // Small delay for reflow
      await new Promise((r) => setTimeout(r, 300));
    }

    const result = await bridge.evaluate(`(() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const docW = document.documentElement.scrollWidth;
      const docH = document.documentElement.scrollHeight;
      const overflow = docW > vw;

      // Find elements that overflow horizontally
      const overflowing = [];
      if (overflow) {
        document.querySelectorAll('*').forEach(el => {
          const rect = el.getBoundingClientRect();
          if (rect.right > vw + 5 && el.tagName !== 'HTML' && el.tagName !== 'BODY') {
            overflowing.push({
              tag: el.tagName.toLowerCase(),
              id: el.id || null,
              class: (el.className || '').toString().slice(0, 50),
              width: Math.round(rect.width),
              overflow: Math.round(rect.right - vw),
            });
          }
        });
      }

      // Check active media queries
      const breakpoints = [320, 375, 480, 640, 768, 1024, 1280, 1536, 1920];
      const activeBreakpoints = breakpoints.filter(bp =>
        window.matchMedia('(min-width: ' + bp + 'px)').matches
      );

      return JSON.stringify({
        viewport: { width: vw, height: vh },
        document: { width: docW, height: docH },
        overflow,
        overflowingElements: overflowing.slice(0, 10),
        activeBreakpoints,
        devicePixelRatio: window.devicePixelRatio,
      });
    })()`, tabId);

    const data = typeof result === 'string' ? JSON.parse(result) : result;
    const label = preset || `${data.viewport.width}x${data.viewport.height}`;
    const lines = [
      `[Viewport Test] ${label} (${data.viewport.width}x${data.viewport.height}, ${data.devicePixelRatio}x DPR)`,
      `  Document: ${data.document.width}x${data.document.height}`,
      `  Horizontal Overflow: ${data.overflow ? `YES (+${data.document.width - data.viewport.width}px)` : 'No'}`,
      `  Active Breakpoints: ${data.activeBreakpoints.join(', ')}px`,
    ];

    if (data.overflowingElements.length > 0) {
      lines.push('', '── Overflowing Elements ──');
      for (const el of data.overflowingElements) {
        lines.push(`  <${el.tag}${el.id ? '#' + el.id : ''}${el.class ? '.' + el.class.split(' ')[0] : ''}> width:${el.width}px, overflow:${el.overflow}px`);
      }
    }

    return textResult(lines.join('\n'));
  }

  // ── Page Text ──────────────────────────────────────────────

  private async handleTextContent(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;

    const result = await bridge.evaluate(`(() => {
      const blocks = [];
      const walk = (el) => {
        if (!el || !el.tagName) return;
        const tag = el.tagName.toLowerCase();
        if (['script','style','noscript','meta','link','template'].includes(tag)) return;
        if (el.offsetParent === null && tag !== 'body' && tag !== 'html') return;

        if (['h1','h2','h3','h4','h5','h6'].includes(tag)) {
          const text = el.textContent.trim();
          if (text) blocks.push({ type: tag, text: text.slice(0, 300) });
        } else if (tag === 'p') {
          const text = el.textContent.trim();
          if (text) blocks.push({ type: 'p', text: text.slice(0, 500) });
        } else if (tag === 'li') {
          const text = el.textContent.trim();
          if (text) blocks.push({ type: 'li', text: text.slice(0, 300) });
        } else if (tag === 'blockquote') {
          const text = el.textContent.trim();
          if (text) blocks.push({ type: 'quote', text: text.slice(0, 500) });
        } else if (tag === 'pre' || tag === 'code') {
          const text = el.textContent.trim();
          if (text) blocks.push({ type: 'code', text: text.slice(0, 1000) });
        } else {
          for (const child of el.children) walk(child);
          return;
        }
        // Don't recurse into already-captured elements
      };
      walk(document.body);
      return JSON.stringify({ title: document.title, blocks: blocks.slice(0, 100), total: blocks.length });
    })()`, tabId);

    const data = typeof result === 'string' ? JSON.parse(result) : result;
    const lines = [`[Text Content] "${data.title}" — ${data.total} blocks`];

    for (const b of data.blocks) {
      if (b.type.startsWith('h')) {
        lines.push('', `${'#'.repeat(parseInt(b.type[1]))} ${b.text}`);
      } else if (b.type === 'li') {
        lines.push(`  • ${b.text}`);
      } else if (b.type === 'quote') {
        lines.push(`  > ${b.text}`);
      } else if (b.type === 'code') {
        lines.push(`  \`\`\`${b.text.slice(0, 200)}\`\`\``);
      } else {
        lines.push(b.text);
      }
    }
    if (data.total > 100) lines.push(`\n... ${data.total - 100} more blocks`);

    return textResult(lines.join('\n'));
  }

  // ── Data Extraction ────────────────────────────────────────

  private async handleTableExtract(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;
    const index = (args.index as number) ?? 0;

    const result = await bridge.evaluate(`(() => {
      const tables = document.querySelectorAll('table');
      if (tables.length === 0) return JSON.stringify({ error: 'No tables found on page' });

      const extractTable = (table) => {
        const headers = [...table.querySelectorAll('thead th, thead td, tr:first-child th')]
          .map(th => th.textContent.trim());
        const rows = [...table.querySelectorAll('tbody tr, tr')]
          .filter(tr => !tr.querySelector('th') || tr.closest('thead'))
          .filter(tr => !tr.closest('thead'))
          .map(tr => [...tr.querySelectorAll('td')]
            .map(td => td.textContent.trim().slice(0, 200)));
        // If no thead, use first row as headers
        if (headers.length === 0 && rows.length > 0) {
          const firstRow = [...table.querySelectorAll('tr:first-child td, tr:first-child th')]
            .map(c => c.textContent.trim());
          if (firstRow.length > 0) return { headers: firstRow, rows: rows.slice(1), rowCount: rows.length - 1 };
        }
        return { headers, rows, rowCount: rows.length };
      };

      const idx = ${index};
      if (idx === -1) {
        return JSON.stringify([...tables].map((t, i) => ({ tableIndex: i, ...extractTable(t) })));
      }
      if (idx >= tables.length) return JSON.stringify({ error: 'Table index ' + idx + ' out of range (found ' + tables.length + ')' });
      return JSON.stringify(extractTable(tables[idx]));
    })()`, tabId);

    const data = typeof result === 'string' ? JSON.parse(result) : result;

    if (data.error) {
      return errorResult(data.error);
    }

    if (Array.isArray(data)) {
      // Multiple tables
      const lines = [`[Tables] ${data.length} tables found`];
      for (const t of data) {
        lines.push('', `── Table ${t.tableIndex} (${t.rowCount} rows) ──`);
        if (t.headers.length > 0) lines.push(`  Headers: ${t.headers.join(' | ')}`);
        for (const row of t.rows.slice(0, 5)) {
          lines.push(`  ${row.join(' | ')}`);
        }
        if (t.rowCount > 5) lines.push(`  ... ${t.rowCount - 5} more rows`);
      }
      return textResult(lines.join('\n'));
    }

    // Single table
    const lines = [`[Table] ${data.rowCount} rows`];
    if (data.headers.length > 0) lines.push(`Headers: ${data.headers.join(' | ')}`);
    lines.push('');
    for (const row of data.rows.slice(0, 20)) {
      lines.push(row.join(' | '));
    }
    if (data.rowCount > 20) lines.push(`... ${data.rowCount - 20} more rows`);

    return textResult(lines.join('\n'));
  }

  private async handleImageList(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;

    const result = await bridge.evaluate(`(() => {
      const imgs = [...document.querySelectorAll('img')].map(img => ({
        src: (img.src || '').slice(0, 200),
        alt: img.alt || '',
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        loaded: img.complete && img.naturalHeight > 0,
        hasAlt: img.hasAttribute('alt'),
      }));
      const broken = imgs.filter(i => !i.loaded).length;
      const missingAlt = imgs.filter(i => !i.hasAlt).length;
      return JSON.stringify({ total: imgs.length, broken, missingAlt, images: imgs.slice(0, 50) });
    })()`, tabId);

    const data = typeof result === 'string' ? JSON.parse(result) : result;
    const lines = [
      `[Images] ${data.total} images (${data.broken} broken, ${data.missingAlt} missing alt)`,
    ];
    for (const img of data.images) {
      const status = img.loaded ? '✓' : '✗';
      const alt = img.hasAlt ? `"${img.alt.slice(0, 50)}"` : '(no alt)';
      lines.push(`  ${status} ${img.width}x${img.height} ${alt} → ${img.src.slice(0, 80)}`);
    }
    if (data.total > 50) lines.push(`  ... ${data.total - 50} more`);
    return textResult(lines.join('\n'));
  }

  private async handleLinkExtract(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;
    const filter = (args.filter as string) || 'all';

    const result = await bridge.evaluate(`(() => {
      const host = location.hostname;
      const links = [...document.querySelectorAll('a[href]')].map(a => {
        const href = a.href;
        const text = (a.textContent || '').trim().slice(0, 100);
        let type = 'external';
        try { if (new URL(href).hostname === host) type = 'internal'; } catch {}
        if (href.startsWith('#') || href.startsWith('javascript:')) type = 'fragment';
        return { href: href.slice(0, 200), text, type };
      });
      const filter = ${JSON.stringify(filter)};
      const filtered = filter === 'all' ? links : links.filter(l => l.type === filter);
      return JSON.stringify({ total: links.length, filtered: filtered.length, links: filtered.slice(0, 100) });
    })()`, tabId);

    const data = typeof result === 'string' ? JSON.parse(result) : result;
    const lines = [`[Links] ${data.filtered} links${filter !== 'all' ? ` (${filter})` : ''} of ${data.total} total`];
    for (const l of data.links) {
      const tag = l.type === 'internal' ? 'INT' : l.type === 'external' ? 'EXT' : 'FRG';
      lines.push(`  [${tag}] ${l.text || '(no text)'} → ${l.href}`);
    }
    if (data.filtered > 100) lines.push(`  ... ${data.filtered - 100} more`);
    return textResult(lines.join('\n'));
  }

  // ── Element Inspector ──────────────────────────────────────

  private async handleElementInfo(args: Record<string, unknown>): Promise<ToolResult> {
    const selector = this.requireString(args, 'selector');
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;

    const selectorJson = JSON.stringify(selector);
    const result = await bridge.evaluate(`(() => {
      const el = document.querySelector(${selectorJson});
      if (!el) return JSON.stringify({ error: 'Element not found: ' + ${selectorJson} });

      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const attrs = {};
      for (const a of el.attributes) attrs[a.name] = a.value;

      return JSON.stringify({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        className: el.className || null,
        text: (el.textContent || '').trim().slice(0, 200),
        bounds: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        styles: {
          display: cs.display,
          visibility: cs.visibility,
          position: cs.position,
          color: cs.color,
          backgroundColor: cs.backgroundColor,
          fontSize: cs.fontSize,
          fontFamily: cs.fontFamily.slice(0, 60),
          fontWeight: cs.fontWeight,
          opacity: cs.opacity,
          zIndex: cs.zIndex,
          overflow: cs.overflow,
        },
        attributes: attrs,
        childCount: el.children.length,
        visible: el.checkVisibility ? el.checkVisibility() : rect.width > 0 && rect.height > 0,
      });
    })()`, tabId);

    const data = typeof result === 'string' ? JSON.parse(result) : result;

    if (data.error) {
      return errorResult(data.error);
    }

    const lines = [
      `[Element] <${data.tag}${data.id ? '#' + data.id : ''}${data.className ? '.' + String(data.className).split(' ').join('.') : ''}>`,
      `  Text: "${data.text.slice(0, 80)}"`,
      `  Visible: ${data.visible}`,
      `  Children: ${data.childCount}`,
      '',
      '── Bounds ──',
      `  x: ${data.bounds.x}, y: ${data.bounds.y}`,
      `  width: ${data.bounds.width}, height: ${data.bounds.height}`,
      '',
      '── Styles ──',
      `  display: ${data.styles.display}, position: ${data.styles.position}`,
      `  color: ${data.styles.color}, bg: ${data.styles.backgroundColor}`,
      `  font: ${data.styles.fontSize} ${data.styles.fontWeight} ${data.styles.fontFamily}`,
      `  opacity: ${data.styles.opacity}, z-index: ${data.styles.zIndex}`,
      '',
      '── Attributes ──',
    ];
    for (const [k, v] of Object.entries(data.attributes)) {
      lines.push(`  ${k}="${String(v).slice(0, 80)}"`);
    }

    return textResult(lines.join('\n'));
  }

  // ── SEO ────────────────────────────────────────────────────

  private async handleMetaSeo(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;

    const result = await bridge.evaluate(`(() => {
      const getMeta = (name) => {
        const el = document.querySelector('meta[name="' + name + '"], meta[property="' + name + '"]');
        return el ? el.getAttribute('content') : null;
      };
      const headings = {};
      document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
        const tag = h.tagName.toLowerCase();
        if (!headings[tag]) headings[tag] = [];
        headings[tag].push(h.textContent.trim().slice(0, 80));
      });
      const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map(s => { try { return JSON.parse(s.textContent); } catch { return null; } })
        .filter(Boolean);
      return JSON.stringify({
        title: document.title,
        titleLength: document.title.length,
        description: getMeta('description'),
        descriptionLength: (getMeta('description') || '').length,
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || null,
        robots: getMeta('robots'),
        lang: document.documentElement.getAttribute('lang'),
        og: {
          title: getMeta('og:title'),
          description: getMeta('og:description'),
          image: getMeta('og:image'),
          url: getMeta('og:url'),
          type: getMeta('og:type'),
        },
        twitter: {
          card: getMeta('twitter:card'),
          title: getMeta('twitter:title'),
          description: getMeta('twitter:description'),
          image: getMeta('twitter:image'),
        },
        headings,
        jsonLd: jsonLd.length > 0 ? jsonLd : null,
        issues: [],
      });
    })()`, tabId);

    const data = typeof result === 'string' ? JSON.parse(result) : result;
    const issues: string[] = [];

    // Check for common SEO issues
    if (!data.title) issues.push('Missing page title');
    else if (data.titleLength > 60) issues.push(`Title too long (${data.titleLength} chars, recommended ≤60)`);
    if (!data.description) issues.push('Missing meta description');
    else if (data.descriptionLength > 160) issues.push(`Description too long (${data.descriptionLength} chars, recommended ≤160)`);
    if (!data.canonical) issues.push('Missing canonical URL');
    if (!data.lang) issues.push('Missing lang attribute on <html>');
    if (!data.og.title) issues.push('Missing Open Graph title');
    if (!data.og.image) issues.push('Missing Open Graph image');
    if (!data.headings.h1 || data.headings.h1.length === 0) issues.push('Missing H1 heading');
    if (data.headings.h1 && data.headings.h1.length > 1) issues.push(`Multiple H1 headings (${data.headings.h1.length})`);

    const lines = [
      `[SEO Audit] ${data.title || '(no title)'}`,
      '',
      '── Meta ──',
      `  Title: ${data.title || '(missing)'} (${data.titleLength} chars)`,
      `  Description: ${(data.description || '(missing)').slice(0, 100)}${data.descriptionLength > 100 ? '...' : ''} (${data.descriptionLength} chars)`,
      `  Canonical: ${data.canonical || '(missing)'}`,
      `  Robots: ${data.robots || '(default)'}`,
      `  Lang: ${data.lang || '(missing)'}`,
      '',
      '── Open Graph ──',
      `  og:title: ${data.og.title || '(missing)'}`,
      `  og:description: ${(data.og.description || '(missing)').slice(0, 80)}`,
      `  og:image: ${data.og.image || '(missing)'}`,
      `  og:type: ${data.og.type || '(missing)'}`,
      '',
      '── Headings ──',
    ];
    for (const [tag, texts] of Object.entries(data.headings) as [string, string[]][]) {
      for (const t of texts.slice(0, 5)) {
        lines.push(`  ${tag}: ${t}`);
      }
    }
    if (data.jsonLd) {
      lines.push('', `── Structured Data ── (${data.jsonLd.length} JSON-LD block(s))`);
    }
    if (issues.length > 0) {
      lines.push('', `── Issues (${issues.length}) ──`);
      for (const i of issues) lines.push(`  ⚠ ${i}`);
    } else {
      lines.push('', '── No major SEO issues found ──');
    }

    return textResult(lines.join('\n'));
  }

  // ── Console ────────────────────────────────────────────────

  private async handleConsoleLog(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;
    const level = (args.level as string) || 'all';

    const result = await bridge.evaluate(`(() => {
      // Install interceptor if not already present
      if (!window.__alyConsoleLog) {
        window.__alyConsoleLog = [];
        const maxEntries = 200;
        ['log','warn','error','info'].forEach(method => {
          const orig = console[method].bind(console);
          console[method] = (...args) => {
            if (window.__alyConsoleLog.length >= maxEntries) window.__alyConsoleLog.shift();
            window.__alyConsoleLog.push({
              level: method,
              message: args.map(a => {
                try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
                catch { return String(a); }
              }).join(' '),
              ts: Date.now(),
            });
            orig(...args);
          };
        });
        // Capture uncaught errors too
        window.addEventListener('error', e => {
          if (window.__alyConsoleLog.length >= maxEntries) window.__alyConsoleLog.shift();
          window.__alyConsoleLog.push({ level: 'error', message: e.message + ' at ' + e.filename + ':' + e.lineno, ts: Date.now() });
        });
      }
      const filter = ${JSON.stringify(level)};
      const logs = filter === 'all'
        ? [...window.__alyConsoleLog]
        : window.__alyConsoleLog.filter(l => l.level === filter);
      // Drain after read
      window.__alyConsoleLog = [];
      return JSON.stringify(logs);
    })()`, tabId);

    const logs = typeof result === 'string' ? JSON.parse(result) : result;

    if (!logs || logs.length === 0) {
      return textResult(`[Console] No messages${level !== 'all' ? ` (level: ${level})` : ''}. Interceptor installed — future messages will be captured.`);
    }

    const lines = [`[Console] ${logs.length} messages`];
    for (const log of logs.slice(-50)) {
      const msg = (log.message || '').slice(0, 200);
      const tag = log.level === 'error' ? 'ERR' : log.level === 'warn' ? 'WRN' : log.level.toUpperCase();
      lines.push(`  [${tag}] ${msg}`);
    }

    return textResult(lines.join('\n'));
  }

  // ── Network ────────────────────────────────────────────────

  private async handleNetworkLog(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;
    const filter = args.filter as string | undefined;

    const filterJson = filter ? JSON.stringify(filter) : 'null';
    const result = await bridge.evaluate(`(() => {
      const filter = ${filterJson};
      const entries = performance.getEntriesByType('resource');
      const filtered = filter
        ? entries.filter(e => e.name.includes(filter))
        : entries;
      return JSON.stringify(
        filtered.slice(-50).map(e => ({
          url: e.name.length > 120 ? e.name.slice(0, 120) + '...' : e.name,
          type: e.initiatorType,
          size: e.transferSize || 0,
          duration: Math.round(e.duration),
          start: Math.round(e.startTime),
        }))
      );
    })()`, tabId);

    const entries = typeof result === 'string' ? JSON.parse(result) : result;

    if (!entries || entries.length === 0) {
      return textResult(`[Network Log] No requests found${filter ? ` matching "${filter}"` : ''}.`);
    }

    const lines = [
      `[Network Log] ${entries.length} requests${filter ? ` matching "${filter}"` : ''}`,
      '',
    ];
    for (const e of entries) {
      const size = e.size > 1024 ? `${(e.size / 1024).toFixed(1)}KB` : `${e.size}B`;
      lines.push(`  [${e.type}] ${e.url} — ${size}, ${e.duration}ms`);
    }

    return textResult(lines.join('\n'));
  }

  // ── Form Automation ────────────────────────────────────────

  private async handleFormDetect(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;

    const fields = await bridge.evaluate(`(() => {
      const classify = (el) => {
        const name = (el.name || '').toLowerCase();
        const id = (el.id || '').toLowerCase();
        const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
        const type = (el.type || 'text').toLowerCase();
        const label = el.labels?.[0]?.textContent?.toLowerCase() || '';
        const ph = (el.placeholder || '').toLowerCase();
        const all = name + ' ' + id + ' ' + ac + ' ' + label + ' ' + ph;

        if (type === 'email' || ac === 'email' || all.includes('email')) return 'email';
        if (type === 'password' || ac === 'new-password' || ac === 'current-password') return 'password';
        if (type === 'tel' || ac === 'tel' || all.includes('phone') || all.includes('tel')) return 'phone';
        if (ac === 'given-name' || all.includes('first') && all.includes('name')) return 'firstName';
        if (ac === 'family-name' || all.includes('last') && all.includes('name')) return 'lastName';
        if (ac === 'name' || all.includes('name') && !all.includes('user')) return 'name';
        if (ac === 'username' || all.includes('user')) return 'username';
        if (ac === 'street-address' || all.includes('address') || all.includes('street')) return 'address';
        if (ac === 'address-level2' || all.includes('city')) return 'city';
        if (ac === 'postal-code' || all.includes('zip') || all.includes('postal')) return 'zip';
        if (ac === 'country' || all.includes('country')) return 'country';
        if (ac === 'organization' || all.includes('company') || all.includes('org')) return 'company';
        return 'unknown';
      };
      return JSON.stringify(
        [...document.querySelectorAll('input, select, textarea')]
          .filter(el => el.type !== 'hidden' && el.type !== 'submit' && el.type !== 'button')
          .map(el => ({
            tag: el.tagName.toLowerCase(),
            type: el.type || 'text',
            name: el.name || '',
            id: el.id || '',
            autocomplete: el.getAttribute('autocomplete') || '',
            semantic: classify(el),
            value: el.type === 'password' ? '' : (el.value || '').slice(0, 50),
            required: el.required,
          }))
      );
    })()`, tabId);

    const parsed = typeof fields === 'string' ? JSON.parse(fields) : fields;
    return jsonResult(parsed);
  }

  private async handleFormFill(args: Record<string, unknown>): Promise<ToolResult> {
    const data = args.data as Record<string, string>;
    if (!data || typeof data !== 'object') {
      return errorResult('"data" must be an object with field values');
    }

    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;

    const dataJson = JSON.stringify(data);
    const result = await bridge.evaluate(`(() => {
      const data = ${dataJson};
      const filled = [];
      const skipped = [];

      const classify = (el) => {
        const name = (el.name || '').toLowerCase();
        const id = (el.id || '').toLowerCase();
        const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
        const type = (el.type || 'text').toLowerCase();
        const label = el.labels?.[0]?.textContent?.toLowerCase() || '';
        const ph = (el.placeholder || '').toLowerCase();
        const all = name + ' ' + id + ' ' + ac + ' ' + label + ' ' + ph;

        if (type === 'email' || ac === 'email' || all.includes('email')) return 'email';
        if (type === 'password' || ac === 'new-password' || ac === 'current-password') return 'password';
        if (type === 'tel' || ac === 'tel' || all.includes('phone') || all.includes('tel')) return 'phone';
        if (ac === 'given-name' || all.includes('first') && all.includes('name')) return 'firstName';
        if (ac === 'family-name' || all.includes('last') && all.includes('name')) return 'lastName';
        if (ac === 'name' || all.includes('name') && !all.includes('user')) return 'name';
        if (ac === 'username' || all.includes('user')) return 'username';
        if (ac === 'street-address' || all.includes('address') || all.includes('street')) return 'address';
        if (ac === 'address-level2' || all.includes('city')) return 'city';
        if (ac === 'postal-code' || all.includes('zip') || all.includes('postal')) return 'zip';
        if (ac === 'country' || all.includes('country')) return 'country';
        if (ac === 'organization' || all.includes('company') || all.includes('org')) return 'company';
        return null;
      };

      document.querySelectorAll('input, select, textarea').forEach(el => {
        if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;
        const semantic = classify(el);
        const byName = data[el.name] || data[el.id];
        const bySemantic = semantic ? data[semantic] : null;
        const value = byName || bySemantic;

        if (value) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
          )?.set;
          if (nativeInputValueSetter) nativeInputValueSetter.call(el, value);
          else el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          filled.push({ name: el.name || el.id, semantic, value: el.type === 'password' ? '***' : value });
        } else {
          skipped.push({ name: el.name || el.id, semantic, type: el.type });
        }
      });

      return JSON.stringify({ filled, skipped });
    })()`, tabId);

    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    const lines = [
      `[Form Fill] ${parsed.filled.length} filled, ${parsed.skipped.length} skipped`,
    ];
    if (parsed.filled.length > 0) {
      lines.push('', '── Filled ──');
      for (const f of parsed.filled) {
        lines.push(`  ${f.name || f.semantic}: ${f.value}`);
      }
    }
    if (parsed.skipped.length > 0) {
      lines.push('', '── Skipped ──');
      for (const s of parsed.skipped) {
        lines.push(`  ${s.name || '(unnamed)'} [${s.type}] → ${s.semantic || 'unknown'}`);
      }
    }

    return textResult(lines.join('\n'));
  }

  // ── Accessibility ──────────────────────────────────────────

  private async handleA11yAudit(args: Record<string, unknown>): Promise<ToolResult> {
    const bridge = this.ensureConnected(args);
    const tabId = args.tabId as number | undefined;

    const audit = await bridge.evaluate(`(() => {
      const issues = [];
      const add = (severity, rule, el, msg) => issues.push({severity, rule, tag: el?.tagName?.toLowerCase() || '', msg});

      // 1. Images without alt
      document.querySelectorAll('img').forEach(img => {
        if (!img.hasAttribute('alt')) add('critical', 'img-alt', img, 'Image missing alt text: ' + (img.src || '').slice(0, 80));
      });

      // 2. Empty links
      document.querySelectorAll('a').forEach(a => {
        const text = (a.textContent || '').trim();
        const ariaLabel = a.getAttribute('aria-label') || '';
        const img = a.querySelector('img[alt]');
        if (!text && !ariaLabel && !img) add('critical', 'link-name', a, 'Link has no accessible name: ' + (a.href || '').slice(0, 80));
      });

      // 3. Form inputs without labels
      document.querySelectorAll('input, select, textarea').forEach(el => {
        if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;
        const id = el.id;
        const hasLabel = id && document.querySelector('label[for="' + id + '"]');
        const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
        const closestLabel = el.closest('label');
        if (!hasLabel && !ariaLabel && !closestLabel) add('critical', 'label', el, 'Form input missing label: ' + (el.name || el.type));
      });

      // 4. Missing lang attribute
      if (!document.documentElement.hasAttribute('lang')) {
        add('warning', 'html-lang', document.documentElement, 'Missing lang attribute on <html>');
      }

      // 5. Heading hierarchy (skipped levels)
      const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => parseInt(h.tagName[1]));
      for (let i = 1; i < headings.length; i++) {
        if (headings[i] - headings[i-1] > 1) add('warning', 'heading-order', null, 'Heading level skipped: h' + headings[i-1] + ' → h' + headings[i]);
      }

      // 6. Missing h1
      if (!document.querySelector('h1')) add('warning', 'page-has-h1', null, 'Page missing h1 heading');

      // 7. Buttons without accessible name
      document.querySelectorAll('button').forEach(btn => {
        const text = (btn.textContent || '').trim();
        const ariaLabel = btn.getAttribute('aria-label') || '';
        if (!text && !ariaLabel) add('warning', 'button-name', btn, 'Button has no accessible name');
      });

      // 8. Auto-playing media
      document.querySelectorAll('video[autoplay], audio[autoplay]').forEach(el => {
        add('warning', 'no-autoplay', el, 'Auto-playing media detected');
      });

      // 9. Missing document title
      if (!document.title.trim()) add('warning', 'document-title', null, 'Page has no title');

      // 10. Tabindex > 0 (disrupts natural tab order)
      document.querySelectorAll('[tabindex]').forEach(el => {
        const ti = parseInt(el.getAttribute('tabindex') || '0');
        if (ti > 0) add('info', 'tabindex', el, 'Positive tabindex (' + ti + ') disrupts tab order');
      });

      return JSON.stringify(issues);
    })()`, tabId);

    const issues = typeof audit === 'string' ? JSON.parse(audit) : audit;

    if (!issues || issues.length === 0) {
      return textResult('[Accessibility Audit] No issues found. Page passes basic WCAG checks.');
    }

    const critical = issues.filter((i: any) => i.severity === 'critical');
    const warnings = issues.filter((i: any) => i.severity === 'warning');
    const info = issues.filter((i: any) => i.severity === 'info');

    const lines = [
      `[Accessibility Audit] ${issues.length} issues found`,
      `  Critical: ${critical.length}, Warning: ${warnings.length}, Info: ${info.length}`,
    ];

    if (critical.length > 0) {
      lines.push('', '── Critical ──');
      for (const i of critical.slice(0, 15)) {
        lines.push(`  [${i.rule}] ${i.msg}`);
      }
    }
    if (warnings.length > 0) {
      lines.push('', '── Warning ──');
      for (const i of warnings.slice(0, 10)) {
        lines.push(`  [${i.rule}] ${i.msg}`);
      }
    }
    if (info.length > 0) {
      lines.push('', '── Info ──');
      for (const i of info.slice(0, 5)) {
        lines.push(`  [${i.rule}] ${i.msg}`);
      }
    }

    return textResult(lines.join('\n'));
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
    const entries = this.siteKnowledge.query(url);
    return textResult(
      `Recorded: (${result}) ${action} on ${url}\n` +
      `Total entries for this site: ${entries.length}\n` +
      `This knowledge will be auto-shown on future visits to this site.`,
    );
  }

  private async handleGetKnowledge(args: Record<string, unknown>): Promise<ToolResult> {
    let url = args.url as string | undefined;
    if (!url) {
      const sessionId = this.getSessionId(args);
      const bridge = this.sessions.get(sessionId);
      if (bridge?.isConnected) {
        const href = await bridge.evaluate('location.href');
        url = typeof href === 'string' ? href : String(href);
      }
    }
    if (!url) {
      return errorResult('No URL provided and no active browser session.');
    }
    const entries = this.siteKnowledge.query(url);
    if (entries.length === 0) {
      return textResult(
        `No knowledge recorded for ${url}\n` +
        `Use browser_learn to record experiences (success/fail) for this site.\n` +
        `Example: browser_learn(url, action="click login", result="fail", note="button inside iframe")`,
      );
    }
    return textResult(this.siteKnowledge.formatForContext(url)!);
  }

  // ── Session Management ─────────────────────────────────────

  private async handleSessionList(): Promise<ToolResult> {
    const list = [];
    for (const [id, bridge] of this.sessions) {
      list.push({
        sessionId: id,
        port: bridge.port,
        connected: bridge.isConnected,
      });
    }
    if (list.length === 0) {
      return textResult('No active browser sessions. Use browser_launch to start one.');
    }
    return jsonResult(list);
  }

  private async handleSessionCloseAll(): Promise<ToolResult> {
    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      const bridge = this.sessions.get(id);
      if (bridge) {
        await bridge.close().catch(() => {});
        this.sessions.delete(id);
      }
    }
    this.lastUrlPerTab.clear();
    this.knowledgeShownPaths.clear();
    return textResult(`Closed ${ids.length} session(s): ${ids.join(', ') || 'none'}`);
  }

  // ── Auto-Learn ──────────────────────────────────────────────

  private async getCurrentUrl(sessionId: string, tabId?: number): Promise<string | null> {
    try {
      const bridge = this.sessions.get(sessionId);
      if (bridge?.isConnected) {
        const href = await bridge.evaluate('location.href', tabId);
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

  private knowledgeKey(url: string): string {
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname.replace(/^www\./, '');
      const segments = parsed.pathname.split('/').filter(Boolean);
      const prefix = segments.length > 0 ? `/${segments[0]}` : '/';
      return `${domain}:${prefix}`;
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
    const { tabId, sessionId, ...rest } = args;
    const parts = Object.entries(rest).map(([k, v]) => {
      const val = typeof v === 'string' && v.length > 50 ? v.slice(0, 50) + '...' : v;
      return `${k}=${val}`;
    });
    return parts.join(', ') || 'no args';
  }

  // ── Screen Tools ────────────────────────────────────────────

  private async handleScreenCapture(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = screen.captureScreen({
      windowTitle: args.windowTitle as string | undefined,
    });
    return {
      content: [
        { type: 'text', text: `Screenshot saved: ${filePath}` },
        { type: 'text', text: `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}` },
      ],
    };
  }

  private async handleScreenClick(args: Record<string, unknown>): Promise<ToolResult> {
    screen.clickAt(args.x as number, args.y as number, { double: args.double as boolean });
    return textResult(`Clicked at (${args.x}, ${args.y})${args.double ? ' (double)' : ''}`);
  }

  private async handleScreenType(args: Record<string, unknown>): Promise<ToolResult> {
    screen.typeText(args.text as string);
    return textResult(`Typed "${(args.text as string).slice(0, 50)}"`);
  }

  private async handleScreenKey(args: Record<string, unknown>): Promise<ToolResult> {
    screen.pressKey(args.key as string, args.modifiers as string[] | undefined);
    return textResult(`Pressed ${args.key}${args.modifiers ? ` + ${(args.modifiers as string[]).join('+')}` : ''}`);
  }

  private async handleScreenScroll(args: Record<string, unknown>): Promise<ToolResult> {
    screen.scroll(args.deltaY as number);
    return textResult(`Scrolled ${(args.deltaY as number) > 0 ? 'down' : 'up'} by ${Math.abs(args.deltaY as number)}`);
  }

  // ── Cleanup ─────────────────────────────────────────────────

  private async cleanupAll(): Promise<void> {
    for (const [id, bridge] of this.sessions) {
      await bridge.close().catch(() => {});
    }
    this.sessions.clear();
  }

  private _onExit: (() => Promise<void>) | null = null;

  private registerCleanup(): void {
    this._onExit = async () => {
      await this.cleanupAll().catch(() => {});
      process.exit(0);
    };
    process.on('SIGINT', this._onExit);
    process.on('SIGTERM', this._onExit);
  }

  /** Remove process signal listeners. Call when discarding this instance. */
  dispose(): void {
    if (this._onExit) {
      process.removeListener('SIGINT', this._onExit);
      process.removeListener('SIGTERM', this._onExit);
      this._onExit = null;
    }
  }
}
