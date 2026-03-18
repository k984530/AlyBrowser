import { describe, it, expect, afterEach, vi } from 'vitest';
import { AlyBrowserMCPServer } from '../../src/mcp/server';
import { tools } from '../../src/mcp/tools';
import { ExtensionBridge } from '../../src/extension/bridge';

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

  it('browser_permissions_check throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_permissions_check', {})).rejects.toThrow('No browser session');
  });

  it('browser_indexeddb_list throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_indexeddb_list', {})).rejects.toThrow('No browser session');
  });

  it('browser_service_worker_info throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_service_worker_info', {})).rejects.toThrow('No browser session');
  });

  it('browser_resource_hints throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_resource_hints', {})).rejects.toThrow('No browser session');
  });

  it('browser_media_list throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_media_list', {})).rejects.toThrow('No browser session');
  });

  it('browser_xpath_query requires xpath', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_xpath_query', {})).rejects.toThrow('"xpath" must be a non-empty string');
  });

  it('browser_open_graph_preview throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_open_graph_preview', {})).rejects.toThrow('No browser session');
  });

  it('browser_selector_generator requires text or selector', async () => {
    const mcp = create();
    const result = await (mcp as any).handleTool('browser_selector_generator', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"text" or "selector"');
  });

  it('browser_broken_links throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_broken_links', {})).rejects.toThrow('No browser session');
  });

  it('browser_mixed_content_check throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_mixed_content_check', {})).rejects.toThrow('No browser session');
  });

  it('browser_js_coverage throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_js_coverage', {})).rejects.toThrow('No browser session');
  });

  it('browser_web_vitals throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_web_vitals', {})).rejects.toThrow('No browser session');
  });

  it('browser_element_remove requires selector', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_element_remove', {})).rejects.toThrow('"selector" must be a non-empty string');
  });

  it('browser_css_coverage throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_css_coverage', {})).rejects.toThrow('No browser session');
  });

  it('browser_network_throttle requires preset or delay', async () => {
    const mcp = create();
    const result = await (mcp as any).handleTool('browser_network_throttle', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('preset');
  });

  it('browser_device_emulate requires preset or dimensions', async () => {
    const mcp = create();
    const result = await (mcp as any).handleTool('browser_device_emulate', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('preset or width+height');
  });

  it('browser_timezone_set requires timezone', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_timezone_set', {})).rejects.toThrow('"timezone" must be a non-empty string');
  });

  it('browser_user_agent_set requires preset or custom', async () => {
    const mcp = create();
    const result = await (mcp as any).handleTool('browser_user_agent_set', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('preset or custom');
  });

  it('browser_geolocation_mock requires coordinates', async () => {
    const mcp = create();
    const result = await (mcp as any).handleTool('browser_geolocation_mock', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('lat/lng or a preset');
  });

  it('browser_event_listener_list throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_event_listener_list', {})).rejects.toThrow('No browser session');
  });

  it('browser_print_preview throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_print_preview', {})).rejects.toThrow('No browser session');
  });

  it('browser_infinite_scroll throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_infinite_scroll', {})).rejects.toThrow('No browser session');
  });

  it('browser_shadow_dom_pierce requires path', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_shadow_dom_pierce', {})).rejects.toThrow('"path" must be a non-empty string');
  });

  it('browser_json_extract throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_json_extract', {})).rejects.toThrow('No browser session');
  });

  it('browser_scroll_to_bottom throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_scroll_to_bottom', {})).rejects.toThrow('No browser session');
  });

  it('browser_get_url throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_get_url', {})).rejects.toThrow('No browser session');
  });

  it('browser_focus requires selector', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_focus', {})).rejects.toThrow('"selector" must be a non-empty string');
  });

  it('browser_press_key requires key', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_press_key', {})).rejects.toThrow('"key" must be a non-empty string');
  });

  it('browser_double_click throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_double_click', { ref: '@e0' })).rejects.toThrow('No browser session');
  });

  it('browser_right_click requires selector', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_right_click', {})).rejects.toThrow('"selector" must be a non-empty string');
  });

  it('browser_attribute_set requires selector+attribute', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_attribute_set', {})).rejects.toThrow('"selector" must be a non-empty string');
    await expect((mcp as any).handleTool('browser_attribute_set', { selector: '.btn' })).rejects.toThrow('"attribute" must be a non-empty string');
  });

  it('browser_highlight add requires selector', async () => {
    const mcp = create();
    const result = await (mcp as any).handleTool('browser_highlight', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"selector" is required');
  });

  it('browser_page_to_pdf_data throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_page_to_pdf_data', {})).rejects.toThrow('No browser session');
  });

  it('browser_scroll_to_element requires selector', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_scroll_to_element', {})).rejects.toThrow('"selector" must be a non-empty string');
  });

  it('browser_count_elements requires selectors array', async () => {
    const mcp = create();
    const result = await (mcp as any).handleTool('browser_count_elements', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"selectors" must be a non-empty array');
  });

  it('browser_drag_drop requires source', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_drag_drop', { target: '.target' })).rejects.toThrow('"source" must be a non-empty string');
  });

  it('browser_drag_drop requires target', async () => {
    const mcp = create();
    const result = await (mcp as any).handleTool('browser_drag_drop', { source: '.src' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"target" is required');
  });

  it('browser_wait_for_url requires pattern', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_wait_for_url', {})).rejects.toThrow('"pattern" must be a non-empty string');
  });

  it('browser_wait_for_url throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_wait_for_url', { pattern: '/dashboard' })).rejects.toThrow('No browser session');
  });

  // ── Mock bridge tests for new tools ──────────────────────

  describe('handleSnapshotDiff with mock bridge', () => {
    function createMcpWithMockBridge() {
      const mcp = create();
      const mockBridge = { isConnected: true, snapshot: vi.fn() };
      (mcp as any).sessions.set('default', mockBridge);
      return { mcp, mockBridge };
    }

    it('returns first snapshot message when no previous', async () => {
      const { mcp, mockBridge } = createMcpWithMockBridge();
      mockBridge.snapshot.mockResolvedValue('[RootWebArea] "Test"');
      const result = await (mcp as any).handleSnapshotDiff({});
      expect(result.content[0].text).toContain('First snapshot');
    });

    it('returns diff after second call', async () => {
      const { mcp, mockBridge } = createMcpWithMockBridge();
      mockBridge.snapshot.mockResolvedValue('[RootWebArea] "Page1"');
      await (mcp as any).handleSnapshotDiff({});
      mockBridge.snapshot.mockResolvedValue('[RootWebArea] "Page2"');
      const result = await (mcp as any).handleSnapshotDiff({});
      expect(result.content[0].text).toContain('Snapshot Diff');
    });

    it('returns no changes for identical snapshots', async () => {
      const { mcp, mockBridge } = createMcpWithMockBridge();
      const snap = '[RootWebArea] "Same"';
      mockBridge.snapshot.mockResolvedValue(snap);
      await (mcp as any).handleSnapshotDiff({});
      mockBridge.snapshot.mockResolvedValue(snap);
      const result = await (mcp as any).handleSnapshotDiff({});
      expect(result.content[0].text).toContain('No changes');
    });
  });

  it('browser_click_all requires selector', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_click_all', {})).rejects.toThrow('"selector" must be a non-empty string');
  });

  it('browser_popup_blocker throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_popup_blocker', {})).rejects.toThrow('No browser session');
  });

  it('browser_find_text requires query', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_find_text', {})).rejects.toThrow('"query" must be a non-empty string');
  });

  it('browser_find_text throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_find_text', { query: 'test' })).rejects.toThrow('No browser session');
  });

  it('browser_font_list throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_font_list', {})).rejects.toThrow('No browser session');
  });

  it('browser_color_picker throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_color_picker', {})).rejects.toThrow('No browser session');
  });

  it('browser_dialog_handler throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_dialog_handler', {})).rejects.toThrow('No browser session');
  });

  it('browser_style_override inject requires css', async () => {
    const mcp = create();
    const result = await (mcp as any).handleTool('browser_style_override', { action: 'inject' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"css" is required');
  });

  it('browser_style_override remove requires id', async () => {
    const mcp = create();
    const result = await (mcp as any).handleTool('browser_style_override', { action: 'remove' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"id" is required');
  });

  it('browser_local_storage throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_local_storage', {})).rejects.toThrow('No browser session');
  });

  it('browser_local_storage set requires key+value', async () => {
    const mcp = create();
    const result = await (mcp as any).handleTool('browser_local_storage', { action: 'set' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"key" and "value" required');
  });

  it('browser_local_storage delete requires key', async () => {
    const mcp = create();
    const result = await (mcp as any).handleTool('browser_local_storage', { action: 'delete' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"key" required');
  });

  it('browser_wait_for_text requires text param', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_wait_for_text', {})).rejects.toThrow('"text" must be a non-empty string');
  });

  it('browser_wait_for_text throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_wait_for_text', { text: 'hello' })).rejects.toThrow('No browser session');
  });

  it('browser_page_audit throws without session', async () => {
    const mcp = create();
    await expect((mcp as any).handleTool('browser_page_audit', {})).rejects.toThrow('No browser session');
  });

  it('browser_session_clone requires targetSessionId', async () => {
    const mcp = create();
    const result = await (mcp as any).handleTool('browser_session_clone', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('"targetSessionId" is required');
  });

  it('browser_session_clone rejects missing source', async () => {
    const mcp = create();
    const result = await (mcp as any).handleTool('browser_session_clone', { targetSessionId: 'new' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
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

  // ── Mock Bridge Scenario Tests ──────────────────────────────
  describe('with mock bridge (browser scenarios)', () => {
    function createMockBridge(): ExtensionBridge {
      const bridge = Object.create(ExtensionBridge.prototype) as ExtensionBridge;
      // Override getters with plain properties via defineProperty
      Object.defineProperty(bridge, 'ws', { value: { readyState: 1 }, writable: true });
      Object.defineProperty(bridge, 'isConnected', { get: () => true });
      Object.defineProperty(bridge, 'sessionId', { get: () => 'mock-session' });
      Object.defineProperty(bridge, 'port', { get: () => 12345 });

      bridge.send = vi.fn().mockImplementation(async (action: string, params?: Record<string, unknown>) => {
        switch (action) {
          case 'snapshot':
            return '[page] Example\n  [@e1] button "Login"\n  [@e2] input "Email"\n  [@e3] link "Help"';
          case 'click':
            return undefined;
          case 'type':
            return undefined;
          case 'navigate':
            return undefined;
          case 'evaluate':
            return JSON.stringify({ result: 42 });
          case 'select':
            return undefined;
          case 'hover':
            return undefined;
          case 'tabs':
            return [{ id: 1, title: 'Example', url: 'https://example.com', active: true }];
          case 'frames':
            return [{ frameId: 0, url: 'https://example.com', name: '' }];
          case 'cookies':
            return [{ name: 'sid', value: 'abc', domain: '.example.com' }];
          case 'html':
            return '<html><body><h1>Hello</h1></body></html>';
          default:
            return undefined;
        }
      });

      const snapshotText = '[page] Example\n  [@e1] button "Login"\n  [@e2] input "Email"\n  [@e3] link "Help"';
      bridge.snapshot = vi.fn().mockResolvedValue(snapshotText);
      bridge.click = vi.fn().mockResolvedValue(undefined);
      bridge.type = vi.fn().mockResolvedValue(undefined);
      bridge.navigate = vi.fn().mockResolvedValue(undefined);
      bridge.evaluate = vi.fn().mockResolvedValue(JSON.stringify({ result: 42 }));
      bridge.selectOption = vi.fn().mockResolvedValue(undefined);
      bridge.hover = vi.fn().mockResolvedValue(undefined);
      bridge.close = vi.fn().mockResolvedValue(undefined);
      // Methods used by specific handlers
      (bridge as any).getHTML = vi.fn().mockResolvedValue('<html><body><h1>Hello</h1></body></html>');
      (bridge as any).tabList = vi.fn().mockResolvedValue([
        { id: 1, title: 'Example', url: 'https://example.com', active: true },
      ]);
      (bridge as any).tabNew = vi.fn().mockResolvedValue({ id: 2, url: 'about:blank' });
      (bridge as any).tabClose = vi.fn().mockResolvedValue(undefined);
      (bridge as any).tabSwitch = vi.fn().mockResolvedValue(undefined);
      (bridge as any).cookieGet = vi.fn().mockResolvedValue([
        { name: 'sid', value: 'abc', domain: '.example.com' },
      ]);
      (bridge as any).cookieSet = vi.fn().mockResolvedValue(undefined);
      (bridge as any).cookieDelete = vi.fn().mockResolvedValue(undefined);
      (bridge as any).frameList = vi.fn().mockResolvedValue([
        { frameId: 0, parentFrameId: -1, url: 'https://example.com' },
      ]);
      (bridge as any).scrollBy = vi.fn().mockResolvedValue(undefined);
      (bridge as any).waitForSelector = vi.fn().mockResolvedValue(undefined);
      (bridge as any).waitForStable = vi.fn().mockResolvedValue(undefined);

      return bridge;
    }

    function injectMockBridge(mcp: AlyBrowserMCPServer, sessionId = 'default'): ExtensionBridge {
      const bridge = createMockBridge();
      (mcp as any).sessions.set(sessionId, bridge);
      return bridge;
    }

    it('snapshot returns accessibility tree', async () => {
      const mcp = create();
      injectMockBridge(mcp);

      const result = await (mcp as any).handleTool('browser_snapshot', {});
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('@e1');
      expect(result.content[0].text).toContain('Login');
    });

    it('click + snapshot flow', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);

      const result = await (mcp as any).handleTool('browser_click', { ref: '@e1' });
      expect(result.isError).toBeFalsy();
      expect(bridge.click).toHaveBeenCalledWith('@e1', undefined, undefined);
      expect(bridge.snapshot).toHaveBeenCalled();
      expect(result.content[0].text).toContain('Clicked @e1');
    });

    it('type into input field', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);

      const result = await (mcp as any).handleTool('browser_type', {
        ref: '@e2', text: 'user@example.com',
      });
      expect(result.isError).toBeFalsy();
      expect(bridge.type).toHaveBeenCalledWith(
        '@e2', 'user@example.com',
        expect.objectContaining({ clear: false }),
      );
      expect(result.content[0].text).toContain('Typed');
    });

    it('eval returns JavaScript result', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);

      const result = await (mcp as any).handleTool('browser_eval', {
        expression: 'document.title',
      });
      expect(result.isError).toBeFalsy();
      expect(bridge.evaluate).toHaveBeenCalledWith('document.title', undefined);
    });

    it('html returns page source', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);

      const result = await (mcp as any).handleTool('browser_html', {});
      expect(result.isError).toBeFalsy();
      expect((bridge as any).getHTML).toHaveBeenCalled();
      expect(result.content[0].text).toContain('<html>');
    });

    it('tab_list returns tabs', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);

      const result = await (mcp as any).handleTool('browser_tab_list', {});
      expect(result.isError).toBeFalsy();
      expect((bridge as any).tabList).toHaveBeenCalled();
    });

    it('frame_list returns frames with depth', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);

      const result = await (mcp as any).handleTool('browser_frame_list', {});
      expect(result.isError).toBeFalsy();
      expect((bridge as any).frameList).toHaveBeenCalled();
      const frames = JSON.parse(result.content[0].text);
      expect(frames[0].depth).toBe(0);
    });

    it('cookie_get returns cookies', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);

      const result = await (mcp as any).handleTool('browser_cookie_get', {
        url: 'https://example.com',
      });
      expect(result.isError).toBeFalsy();
      expect((bridge as any).cookieGet).toHaveBeenCalledWith('https://example.com', undefined);
    });

    it('multi-session: tools route to correct bridge', async () => {
      const mcp = create();
      const bridgeA = injectMockBridge(mcp, 'session-a');
      const bridgeB = injectMockBridge(mcp, 'session-b');

      await (mcp as any).handleTool('browser_snapshot', { sessionId: 'session-a' });
      expect(bridgeA.snapshot).toHaveBeenCalled();
      expect(bridgeB.snapshot).not.toHaveBeenCalled();

      vi.clearAllMocks();

      await (mcp as any).handleTool('browser_snapshot', { sessionId: 'session-b' });
      expect(bridgeB.snapshot).toHaveBeenCalled();
      expect(bridgeA.snapshot).not.toHaveBeenCalled();
    });

    it('close removes session from map', async () => {
      const mcp = create();
      injectMockBridge(mcp);

      expect((mcp as any).sessions.has('default')).toBe(true);
      await (mcp as any).handleTool('browser_close', {});
      expect((mcp as any).sessions.has('default')).toBe(false);
    });

    it('session_list shows active mock session', async () => {
      const mcp = create();
      injectMockBridge(mcp);

      const result = await (mcp as any).handleTool('browser_session_list', {});
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('default');
    });

    it('sleep returns after ~1 second', async () => {
      const mcp = create();
      injectMockBridge(mcp);

      const start = Date.now();
      const result = await (mcp as any).handleTool('browser_sleep', {});
      expect(Date.now() - start).toBeGreaterThanOrEqual(900);
      expect(result.content[0].text).toContain('1 second');
    });

    // ── Eval-based tool handler tests ────────────────────────
    it('perf_metrics returns formatted report', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);
      (bridge as any).evaluate = vi.fn().mockResolvedValue(JSON.stringify({
        timing: { ttfb: 50, domInteractive: 200, domContentLoaded: 300, domComplete: 400, load: 500 },
        dom: { elements: 150, depth: 8, scripts: 3, stylesheets: 2, images: 5, forms: 1, iframes: 0 },
        resources: { total: 20, totalSize: 500000, byType: { js: 5, css: 2 } },
        url: 'https://example.com', title: 'Test',
      }));

      const result = await (mcp as any).handleTool('browser_perf_metrics', {});
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('TTFB');
      expect(result.content[0].text).toContain('50ms');
      expect(result.content[0].text).toContain('Elements: 150');
    });

    it('text_content returns structured text', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);
      (bridge as any).evaluate = vi.fn().mockResolvedValue(JSON.stringify({
        title: 'Test Page',
        blocks: [
          { type: 'h1', text: 'Main Title' },
          { type: 'p', text: 'Some paragraph text' },
        ],
        total: 2,
      }));

      const result = await (mcp as any).handleTool('browser_text_content', {});
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Main Title');
    });

    it('form_detect returns field info', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);
      (bridge as any).evaluate = vi.fn().mockResolvedValue(JSON.stringify({
        forms: 1,
        fields: [
          { tag: 'input', type: 'email', name: 'email', id: 'email', autocomplete: 'email', value: '', semantic: 'email' },
          { tag: 'input', type: 'password', name: 'password', id: 'pass', autocomplete: 'current-password', value: '', semantic: 'password' },
        ],
      }));

      const result = await (mcp as any).handleTool('browser_form_detect', {});
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('email');
    });

    it('console_log returns messages', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);
      // console_log returns a flat array of log entries
      (bridge as any).evaluate = vi.fn().mockResolvedValue(JSON.stringify([
        { level: 'error', message: 'Something failed', ts: Date.now() },
        { level: 'log', message: 'Hello world', ts: Date.now() },
      ]));

      const result = await (mcp as any).handleTool('browser_console_log', {});
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Something failed');
    });

    it('navigate calls bridge.navigate', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);

      const result = await (mcp as any).handleTool('browser_navigate', {
        url: 'https://example.com/new',
      });
      expect(result.isError).toBeFalsy();
      expect(bridge.navigate).toHaveBeenCalledWith('https://example.com/new', undefined);
    });

    it('select calls bridge.selectOption', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);

      const result = await (mcp as any).handleTool('browser_select', {
        ref: '@e1', value: 'option1',
      });
      expect(result.isError).toBeFalsy();
      expect(bridge.selectOption).toHaveBeenCalledWith('@e1', 'option1', undefined, undefined);
    });

    it('hover calls bridge.hover', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);

      const result = await (mcp as any).handleTool('browser_hover', { ref: '@e1' });
      expect(result.isError).toBeFalsy();
      expect(bridge.hover).toHaveBeenCalledWith('@e1', undefined, undefined);
    });

    it('scroll calls bridge.scrollBy', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);

      const result = await (mcp as any).handleTool('browser_scroll', { x: 0, y: 300 });
      expect(result.isError).toBeFalsy();
      expect((bridge as any).scrollBy).toHaveBeenCalledWith(expect.objectContaining({ x: 0, y: 300 }));
      expect(result.content[0].text).toContain('Scrolled');
    });

    it('wait calls bridge.waitForSelector', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);

      const result = await (mcp as any).handleTool('browser_wait', { selector: '.loaded' });
      expect(result.isError).toBeFalsy();
      expect((bridge as any).waitForSelector).toHaveBeenCalledWith(
        '.loaded', expect.objectContaining({ hidden: false }),
      );
      expect(result.content[0].text).toContain('.loaded');
    });

    it('wait_for_stable calls bridge.waitForStable', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);

      const result = await (mcp as any).handleTool('browser_wait_for_stable', {});
      expect(result.isError).toBeFalsy();
      expect((bridge as any).waitForStable).toHaveBeenCalled();
      expect(result.content[0].text).toContain('stabilized');
    });

    it('bookmark_list calls bridge.send', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);

      const result = await (mcp as any).handleTool('browser_bookmark_list', {});
      expect(result.isError).toBeFalsy();
    });

    it('storage_get calls bridge.send', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);

      const result = await (mcp as any).handleTool('browser_storage_get', { key: 'mykey' });
      expect(result.isError).toBeFalsy();
    });

    it('websocket_monitor start installs interceptor', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);
      (bridge as any).evaluate = vi.fn().mockResolvedValue('installed');

      const result = await (mcp as any).handleTool('browser_websocket_monitor', { action: 'start' });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Interceptor installed');
      expect((bridge as any).evaluate).toHaveBeenCalled();
    });

    it('websocket_monitor read returns messages', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);
      (bridge as any).evaluate = vi.fn().mockResolvedValue(JSON.stringify({
        installed: true,
        connections: [{ id: 0, url: 'wss://api.example.com/ws', readyState: 1 }],
        messages: [
          { dir: 'send', connId: 0, data: '{"type":"ping"}', ts: Date.now() },
          { dir: 'recv', connId: 0, data: '{"type":"pong"}', ts: Date.now() },
        ],
        total: 2,
      }));

      const result = await (mcp as any).handleTool('browser_websocket_monitor', { action: 'read' });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('wss://api.example.com/ws');
      expect(result.content[0].text).toContain('ping');
      expect(result.content[0].text).toContain('pong');
    });

    it('websocket_monitor read when not installed', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);
      (bridge as any).evaluate = vi.fn().mockResolvedValue(JSON.stringify({ installed: false }));

      const result = await (mcp as any).handleTool('browser_websocket_monitor', { action: 'read' });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Not installed');
    });

    it('websocket_monitor stop removes interceptor', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);
      (bridge as any).evaluate = vi.fn().mockResolvedValue('removed');

      const result = await (mcp as any).handleTool('browser_websocket_monitor', { action: 'stop' });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('removed');
    });

    it('fetch_intercept start installs interceptor', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);
      (bridge as any).evaluate = vi.fn().mockResolvedValue('installed');

      const result = await (mcp as any).handleTool('browser_fetch_intercept', { action: 'start' });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Interceptor installed');
    });

    it('fetch_intercept read returns API requests', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);
      (bridge as any).evaluate = vi.fn().mockResolvedValue(JSON.stringify({
        installed: true,
        requests: [
          { method: 'GET', url: 'https://api.example.com/users', status: 200, reqBody: '', resBody: '[{"id":1}]', duration: 45 },
          { method: 'POST', url: 'https://api.example.com/login', status: 401, reqBody: '{"email":"test"}', resBody: '{"error":"invalid"}', duration: 120 },
        ],
        total: 2,
      }));

      const result = await (mcp as any).handleTool('browser_fetch_intercept', { action: 'read' });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('GET https://api.example.com/users');
      expect(result.content[0].text).toContain('POST https://api.example.com/login');
      expect(result.content[0].text).toContain('45ms');
    });

    it('fetch_intercept read when not installed', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);
      (bridge as any).evaluate = vi.fn().mockResolvedValue(JSON.stringify({ installed: false }));

      const result = await (mcp as any).handleTool('browser_fetch_intercept', { action: 'read' });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('Not installed');
    });

    it('fetch_intercept stop removes interceptor', async () => {
      const mcp = create();
      const bridge = injectMockBridge(mcp);
      (bridge as any).evaluate = vi.fn().mockResolvedValue('removed');

      const result = await (mcp as any).handleTool('browser_fetch_intercept', { action: 'stop' });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('removed');
    });
  });
});
