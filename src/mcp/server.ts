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
      { name: 'aly-browser', version: process.env.npm_package_version || '1.0.0' },
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
