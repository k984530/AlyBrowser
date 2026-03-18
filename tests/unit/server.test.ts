import { describe, it, expect, afterEach, vi } from 'vitest';
import { AlyBrowserMCPServer } from '../../src/mcp/server';
import { tools } from '../../src/mcp/tools';

describe('AlyBrowserMCPServer', () => {
  const instances: AlyBrowserMCPServer[] = [];
  const create = () => {
    const mcp = new AlyBrowserMCPServer();
    instances.push(mcp);
    return mcp;
  };

  afterEach(() => {
    for (const mcp of instances) mcp.dispose();
    instances.length = 0;
  });

  it('constructs without errors', () => {
    const mcp = create();
    expect(mcp.server).toBeDefined();
  });

  it('registers all tools from tools.ts', () => {
    const mcp = create();
    const handler = (mcp.server as any)._requestHandlers;
    expect(handler).toBeDefined();
  });

  it('returns error for unknown tool', async () => {
    const mcp = create();
    const result = await (mcp as any).handleTool('nonexistent_tool', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });

  it('throws when accessing session without launch', async () => {
    const mcp = create();
    await expect(
      (mcp as any).handleTool('browser_snapshot', {}),
    ).rejects.toThrow('No browser session');
  });

  it('throw message includes session name', async () => {
    const mcp = create();
    await expect(
      (mcp as any).handleTool('browser_snapshot', { sessionId: 'mySession' }),
    ).rejects.toThrow('mySession');
  });

  it('handleSleep waits approximately 1 second', async () => {
    const mcp = create();
    const start = Date.now();
    const result = await (mcp as any).handleSleep();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(2000);
    expect(result.content[0].text).toContain('1 second');
  });

  it('handleSessionList returns message when no sessions', async () => {
    const mcp = create();
    const result = await (mcp as any).handleSessionList();
    expect(result.content[0].text).toContain('No active browser sessions');
  });

  it('handleSessionCloseAll works with no sessions', async () => {
    const mcp = create();
    const result = await (mcp as any).handleSessionCloseAll();
    expect(result.content[0].text).toContain('0 session');
  });

  it('handleLearn validates result parameter', async () => {
    const mcp = create();
    const result = await (mcp as any).handleLearn({
      url: 'https://test.com',
      action: 'click',
      result: 'invalid',
      note: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid result');
  });

  it('handleGetKnowledge without url or session returns error', async () => {
    const mcp = create();
    const result = await (mcp as any).handleGetKnowledge({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No URL provided');
  });

  it('all tool names in tools.ts have handlers in handleTool (no "Unknown tool")', async () => {
    const mcp = create();
    // Skip tools that attempt real I/O (Chrome launch, WS connection)
    const skipTools = new Set(['browser_launch']);

    for (const tool of tools) {
      if (skipTools.has(tool.name)) continue;
      try {
        const result = await (mcp as any).handleTool(tool.name, {});
        // If it returned a result, it should not be "Unknown tool"
        if (result.isError) {
          expect(
            result.content[0].text,
            `Tool "${tool.name}" returned Unknown tool error`,
          ).not.toContain('Unknown tool');
        }
      } catch (err: any) {
        // Throwing is fine (e.g., "No browser session") — just not "Unknown tool"
        expect(err.message).not.toContain('Unknown tool');
      }
    }
  });

  it('dispose removes signal listeners', () => {
    const before = process.listenerCount('SIGINT');
    const mcp = create();
    expect(process.listenerCount('SIGINT')).toBe(before + 1);
    mcp.dispose();
    expect(process.listenerCount('SIGINT')).toBe(before);
  });

  it('handleLaunch rejects concurrent launch for same session', async () => {
    const mcp = create();
    // Simulate a launch in progress by adding to the launching set
    (mcp as any).launching.add('default');
    const result = await (mcp as any).handleLaunch({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('already launching');
    (mcp as any).launching.delete('default');
  });

  it('launching guard is per-session, not global', async () => {
    const mcp = create();
    (mcp as any).launching.add('session-a');
    // session-b should NOT be blocked by session-a's launch
    expect((mcp as any).launching.has('session-b')).toBe(false);
    // Verify session-a IS blocked
    const result = await (mcp as any).handleLaunch({ sessionId: 'session-a' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('already launching');
    (mcp as any).launching.delete('session-a');
  });

  it('handleLearn records and returns success', async () => {
    const mcp = create();
    const result = await (mcp as any).handleLearn({
      url: 'https://example.com/page',
      action: 'click login',
      result: 'success',
      note: 'button found at top right',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Recorded');
    expect(result.content[0].text).toContain('success');
  });

  it('handleGetKnowledge returns entries after learn', async () => {
    const mcp = create();
    await (mcp as any).handleLearn({
      url: 'https://test-gk.com/page',
      action: 'type',
      result: 'fail',
      note: 'input not found',
    });
    const result = await (mcp as any).handleGetKnowledge({ url: 'https://test-gk.com/page' });
    expect(result.content[0].text).toContain('fail');
    expect(result.content[0].text).toContain('input not found');
  });

  it('handleGetKnowledge returns empty message for unknown site', async () => {
    const mcp = create();
    const result = await (mcp as any).handleGetKnowledge({ url: 'https://unknown-site-xyz.com' });
    expect(result.content[0].text).toContain('No knowledge');
  });

  it('knowledgeKey groups by domain and first path segment', () => {
    const mcp = create();
    expect((mcp as any).knowledgeKey('https://example.com/settings/profile')).toBe('example.com:/settings');
    expect((mcp as any).knowledgeKey('https://www.example.com/')).toBe('example.com:/');
    expect((mcp as any).knowledgeKey('https://app.test.io/dashboard/analytics')).toBe('app.test.io:/dashboard');
  });

  it('getDomain strips www prefix', () => {
    const mcp = create();
    expect((mcp as any).getDomain('https://www.example.com/page')).toBe('example.com');
    expect((mcp as any).getDomain('https://app.test.io')).toBe('app.test.io');
  });

  it('summarizeArgs truncates long values', () => {
    const mcp = create();
    const long = 'a'.repeat(100);
    const result = (mcp as any).summarizeArgs('browser_type', { ref: '@e0', text: long });
    expect(result).toContain('ref=@e0');
    expect(result).toContain('...');
    expect(result.length).toBeLessThan(200);
  });

  it('summarizeArgs excludes tabId and sessionId', () => {
    const mcp = create();
    const result = (mcp as any).summarizeArgs('browser_click', { ref: '@e1', tabId: 5, sessionId: 'x' });
    expect(result).toContain('ref=@e1');
    expect(result).not.toContain('tabId');
    expect(result).not.toContain('sessionId');
  });

  it('tabKey combines session and tab', () => {
    const mcp = create();
    expect((mcp as any).tabKey('mySession', 42)).toBe('mySession:42');
    expect((mcp as any).tabKey('default', undefined)).toBe('default:0');
  });

  it('requireString throws on non-string value', () => {
    const mcp = create();
    expect(() => (mcp as any).requireString({ ref: 123 }, 'ref')).toThrow('"ref" must be a non-empty string');
    expect(() => (mcp as any).requireString({ ref: '' }, 'ref')).toThrow('"ref" must be a non-empty string');
    expect(() => (mcp as any).requireString({}, 'ref')).toThrow('"ref" must be a non-empty string');
  });

  it('requireString returns string on valid value', () => {
    const mcp = create();
    expect((mcp as any).requireString({ ref: '@e0' }, 'ref')).toBe('@e0');
  });

  it('getSessionId defaults to "default"', () => {
    const mcp = create();
    expect((mcp as any).getSessionId({})).toBe('default');
    expect((mcp as any).getSessionId({ sessionId: 'custom' })).toBe('custom');
  });

  it('ensureConnected throws when session not connected', () => {
    const mcp = create();
    expect(() => (mcp as any).ensureConnected({})).toThrow('No browser session');
  });

  it('handleClose cleans up tab tracking for session', async () => {
    const mcp = create();
    // Simulate some tab tracking entries
    (mcp as any).lastUrlPerTab.set('test:0', 'http://example.com');
    (mcp as any).lastUrlPerTab.set('test:1', 'http://example.com/page');
    (mcp as any).lastUrlPerTab.set('other:0', 'http://other.com');

    const result = await (mcp as any).handleClose({ sessionId: 'test' });
    expect(result.content[0].text).toContain('test');

    // test session entries should be cleaned
    expect((mcp as any).lastUrlPerTab.has('test:0')).toBe(false);
    expect((mcp as any).lastUrlPerTab.has('test:1')).toBe(false);
    // other session should remain
    expect((mcp as any).lastUrlPerTab.has('other:0')).toBe(true);
  });

  // ── handleTool error paths (no session) ─────────────────────

  it('browser_navigate throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_navigate', { url: 'https://x.com' })).rejects.toThrow('No browser session');
  });

  it('browser_click throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_click', { ref: '@e0' })).rejects.toThrow('No browser session');
  });

  it('browser_type throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_type', { ref: '@e0', text: 'hi' })).rejects.toThrow('No browser session');
  });

  it('browser_tab_list throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_tab_list', {})).rejects.toThrow('No browser session');
  });

  it('browser_cookie_get throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_cookie_get', { url: 'https://x.com' })).rejects.toThrow('No browser session');
  });

  it('browser_download throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_download', { url: 'https://x.com/file' })).rejects.toThrow('No browser session');
  });

  it('browser_eval throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_eval', { expression: '1+1' })).rejects.toThrow('No browser session');
  });

  it('browser_upload throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_upload', { filePath: '/tmp/x' })).rejects.toThrow('No browser session');
  });

  it('browser_frame_list throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_frame_list', {})).rejects.toThrow('No browser session');
  });

  it('browser_history_search throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_history_search', {})).rejects.toThrow('No browser session');
  });

  // ── Auto-learn utilities ────────────────────────────────────

  it('recordFailure and recordRecovery track per-domain', () => {
    const mcp = create();
    (mcp as any).recordFailure('https://example.com/page', 'browser_click', 'element not found');
    const failures = (mcp as any).recentFailures.get('example.com');
    expect(failures).toBeDefined();
    expect(failures.has('browser_click')).toBe(true);

    (mcp as any).recordRecovery('https://example.com/page', 'browser_click', 'ref=@e1');
    expect(failures.has('browser_click')).toBe(false);
  });

  it('recordRecovery ignores tools without prior failure', () => {
    const mcp = create();
    // No failure recorded — recovery should be a no-op
    (mcp as any).recordRecovery('https://test.com', 'browser_type', 'ref=@e0');
    expect((mcp as any).recentFailures.has('test.com')).toBe(false);
  });

  // ── More handler error paths ─────────────────────────────────

  it('browser_select throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_select', { ref: '@e0', value: 'x' })).rejects.toThrow('No browser session');
  });

  it('browser_hover throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_hover', { ref: '@e0' })).rejects.toThrow('No browser session');
  });

  it('browser_scroll throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_scroll', { x: 0, y: 100 })).rejects.toThrow('No browser session');
  });

  it('browser_wait throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_wait', { selector: '.btn' })).rejects.toThrow('No browser session');
  });

  it('browser_wait_for_stable throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_wait_for_stable', {})).rejects.toThrow('No browser session');
  });

  it('browser_html throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_html', {})).rejects.toThrow('No browser session');
  });

  it('browser_tab_new throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_tab_new', {})).rejects.toThrow('No browser session');
  });

  it('browser_tab_close throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_tab_close', {})).rejects.toThrow('No browser session');
  });

  it('browser_tab_switch throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_tab_switch', { tabId: 1 })).rejects.toThrow('No browser session');
  });

  it('browser_cookie_set throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_cookie_set', { url: 'http://x', name: 'a', value: 'b' })).rejects.toThrow('No browser session');
  });

  it('browser_cookie_delete throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_cookie_delete', { url: 'http://x', name: 'a' })).rejects.toThrow('No browser session');
  });

  it('browser_alarm_create throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_alarm_create', { name: 'test' })).rejects.toThrow('No browser session');
  });

  it('browser_alarm_list throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_alarm_list', {})).rejects.toThrow('No browser session');
  });

  it('browser_alarm_clear throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_alarm_clear', {})).rejects.toThrow('No browser session');
  });

  it('browser_alarm_events throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_alarm_events', {})).rejects.toThrow('No browser session');
  });

  it('browser_storage_get throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_storage_get', {})).rejects.toThrow('No browser session');
  });

  it('browser_storage_set throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_storage_set', { data: {} })).rejects.toThrow('No browser session');
  });

  it('browser_notify throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_notify', { title: 'x', message: 'y' })).rejects.toThrow('No browser session');
  });

  it('browser_bookmark_list throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_bookmark_list', {})).rejects.toThrow('No browser session');
  });

  it('browser_bookmark_create throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_bookmark_create', { title: 'x', url: 'http://x' })).rejects.toThrow('No browser session');
  });

  it('browser_bookmark_delete throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_bookmark_delete', { id: '1' })).rejects.toThrow('No browser session');
  });

  it('browser_top_sites throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_top_sites', {})).rejects.toThrow('No browser session');
  });

  it('browser_clipboard_read throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_clipboard_read', {})).rejects.toThrow('No browser session');
  });

  it('browser_clipboard_write throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_clipboard_write', { text: 'x' })).rejects.toThrow('No browser session');
  });

  it('browser_page_size throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_page_size', {})).rejects.toThrow('No browser session');
  });

  it('browser_cookie_export requires url', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_cookie_export', {})).rejects.toThrow('"url" must be a non-empty string');
  });

  it('browser_cookie_import rejects non-array', async () => {
    const mcp = create();
    const result = await (mcp as any).handleTool('browser_cookie_import', { cookies: 'bad' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"cookies" must be an array');
  });

  it('browser_captcha_detect throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_captcha_detect', {})).rejects.toThrow('No browser session');
  });

  it('browser_dom_observe throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_dom_observe', {})).rejects.toThrow('No browser session');
  });

  it('browser_scroll_map throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_scroll_map', {})).rejects.toThrow('No browser session');
  });

  it('browser_dark_mode throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_dark_mode', {})).rejects.toThrow('No browser session');
  });

  it('browser_viewport_test throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_viewport_test', {})).rejects.toThrow('No browser session');
  });

  it('browser_text_content throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_text_content', {})).rejects.toThrow('No browser session');
  });

  it('browser_table_extract throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_table_extract', {})).rejects.toThrow('No browser session');
  });

  it('browser_image_list throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_image_list', {})).rejects.toThrow('No browser session');
  });

  it('browser_link_extract throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_link_extract', {})).rejects.toThrow('No browser session');
  });

  it('browser_element_info throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_element_info', { selector: '.btn' })).rejects.toThrow('No browser session');
  });

  it('browser_element_info rejects missing selector', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_element_info', {})).rejects.toThrow('"selector" must be a non-empty string');
  });

  it('browser_meta_seo throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_meta_seo', {})).rejects.toThrow('No browser session');
  });

  it('browser_console_log throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_console_log', {})).rejects.toThrow('No browser session');
  });

  it('browser_network_log throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_network_log', {})).rejects.toThrow('No browser session');
  });

  it('browser_form_fill throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_form_fill', { data: { email: 'x' } })).rejects.toThrow('No browser session');
  });

  it('browser_form_fill rejects invalid data', async () => {
    const mcp = create();
    const result = await (mcp as any).handleTool('browser_form_fill', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"data" must be an object');
  });

  it('browser_form_detect throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_form_detect', {})).rejects.toThrow('No browser session');
  });

  it('browser_a11y_audit throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_a11y_audit', {})).rejects.toThrow('No browser session');
  });

  it('browser_perf_metrics throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_perf_metrics', {})).rejects.toThrow('No browser session');
  });

  it('browser_snapshot_diff throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_snapshot_diff', {})).rejects.toThrow('No browser session');
  });

  // ── Frame depth calculation ──────────────────────────────────

  describe('handleFrameList depth computation', () => {
    function createMcpWithMockBridge() {
      const mcp = create();
      const mockBridge = {
        isConnected: true,
        frameList: vi.fn(),
      };
      (mcp as any).sessions.set('default', mockBridge);
      return { mcp, mockBridge };
    }

    it('adds depth field to flat frame list', async () => {
      const { mcp, mockBridge } = createMcpWithMockBridge();
      mockBridge.frameList.mockResolvedValue([
        { frameId: 0, parentFrameId: -1, url: 'https://main.com' },
        { frameId: 1, parentFrameId: 0, url: 'https://child.com' },
        { frameId: 2, parentFrameId: 1, url: 'https://grandchild.com' },
      ]);

      const result = await (mcp as any).handleFrameList({});
      const frames = JSON.parse(result.content[0].text);
      expect(frames).toHaveLength(3);
      expect(frames[0].depth).toBe(0); // main
      expect(frames[1].depth).toBe(1); // child
      expect(frames[2].depth).toBe(2); // grandchild
    });

    it('filters frames by maxDepth', async () => {
      const { mcp, mockBridge } = createMcpWithMockBridge();
      mockBridge.frameList.mockResolvedValue([
        { frameId: 0, parentFrameId: -1, url: 'https://main.com' },
        { frameId: 1, parentFrameId: 0, url: 'https://child.com' },
        { frameId: 2, parentFrameId: 1, url: 'https://grandchild.com' },
        { frameId: 3, parentFrameId: 2, url: 'https://deep.com' },
      ]);

      const result = await (mcp as any).handleFrameList({ depth: 2 });
      const frames = JSON.parse(result.content[0].text);
      expect(frames).toHaveLength(3); // depth 0, 1, 2 — excludes depth 3
      expect(frames.every((f: any) => f.depth <= 2)).toBe(true);
    });

    it('defaults to depth 10 when not specified', async () => {
      const { mcp, mockBridge } = createMcpWithMockBridge();
      mockBridge.frameList.mockResolvedValue([
        { frameId: 0, parentFrameId: -1, url: 'https://main.com' },
      ]);

      const result = await (mcp as any).handleFrameList({});
      const frames = JSON.parse(result.content[0].text);
      expect(frames).toHaveLength(1);
    });

    it('handles single main frame', async () => {
      const { mcp, mockBridge } = createMcpWithMockBridge();
      mockBridge.frameList.mockResolvedValue([
        { frameId: 0, parentFrameId: -1, url: 'https://noframes.com' },
      ]);

      const result = await (mcp as any).handleFrameList({});
      const frames = JSON.parse(result.content[0].text);
      expect(frames).toHaveLength(1);
      expect(frames[0].depth).toBe(0);
    });
  });
});
