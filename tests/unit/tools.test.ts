import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tools, type ToolDefinition } from '../../src/mcp/tools';

const ROOT = resolve(__dirname, '../..');

describe('tools definitions', () => {
  it('exports a non-empty array', () => {
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it('has exactly 126 tools', () => {
    expect(tools.length).toBe(126);
  });

  it('every tool has required fields', () => {
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it('has no duplicate tool names', () => {
    const names = tools.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('all required fields exist in properties', () => {
    for (const tool of tools) {
      if (tool.inputSchema.required) {
        for (const req of tool.inputSchema.required) {
          expect(
            tool.inputSchema.properties,
            `${tool.name}: required field "${req}" missing from properties`,
          ).toHaveProperty(req);
        }
      }
    }
  });

  it('all tool names follow naming convention', () => {
    for (const tool of tools) {
      expect(
        tool.name,
        `Tool "${tool.name}" must start with browser_ or screen_`,
      ).toMatch(/^(browser_|screen_)/);
    }
  });

  it('all descriptions are non-trivial', () => {
    for (const tool of tools) {
      expect(
        tool.description.length,
        `Tool "${tool.name}" description too short`,
      ).toBeGreaterThan(10);
    }
  });

  // ── Expected tool inventory (124 tools) ────────────────
  const expectedTools = [
    // Browser Control (5)
    'browser_launch', 'browser_navigate', 'browser_back', 'browser_forward', 'browser_close',
    // Site Knowledge (2)
    'browser_learn', 'browser_get_knowledge',
    // Page Reading (4)
    'browser_snapshot', 'browser_snapshot_diff', 'browser_html', 'browser_eval',
    // Interaction (8)
    'browser_click', 'browser_type', 'browser_select', 'browser_hover', 'browser_scroll',
    'browser_wait', 'browser_wait_for_stable', 'browser_sleep',
    // Advanced Interaction (9)
    'browser_double_click', 'browser_right_click', 'browser_drag_drop', 'browser_click_all',
    'browser_focus', 'browser_blur', 'browser_press_key', 'browser_upload', 'browser_shadow_dom_pierce',
    // Navigation & Scrolling (7)
    'browser_reload', 'browser_scroll_to_bottom', 'browser_scroll_to_top',
    'browser_scroll_to_element', 'browser_infinite_scroll',
    'browser_wait_for_url', 'browser_wait_for_text',
    // Tabs (4)
    'browser_tab_list', 'browser_tab_new', 'browser_tab_close', 'browser_tab_switch',
    // Frames (1)
    'browser_frame_list',
    // Page Info (6)
    'browser_get_url', 'browser_get_title', 'browser_page_info',
    'browser_element_count', 'browser_element_info', 'browser_text_content',
    // Data Extraction (7)
    'browser_table_extract', 'browser_link_extract', 'browser_image_list',
    'browser_json_extract', 'browser_find_text', 'browser_media_list', 'browser_count_elements',
    // DOM Manipulation (5)
    'browser_element_remove', 'browser_attribute_set', 'browser_highlight',
    'browser_style_override', 'browser_popup_blocker',
    // Form Automation (2)
    'browser_form_fill', 'browser_form_detect',
    // Cookies (5)
    'browser_cookie_get', 'browser_cookie_set', 'browser_cookie_delete',
    'browser_cookie_export', 'browser_cookie_import',
    // Storage (3)
    'browser_storage_get', 'browser_storage_set', 'browser_local_storage',
    // Performance & Audit (7)
    'browser_perf_metrics', 'browser_web_vitals', 'browser_js_coverage',
    'browser_css_coverage', 'browser_page_size', 'browser_resource_hints', 'browser_page_audit',
    // SEO & Social (4)
    'browser_meta_seo', 'browser_open_graph_preview', 'browser_broken_links', 'browser_mixed_content_check',
    // Accessibility (1)
    'browser_a11y_audit',
    // Debugging (5)
    'browser_console_log', 'browser_network_log', 'browser_dom_observe',
    'browser_event_listener_list', 'browser_xpath_query',
    // Testing & Emulation (7)
    'browser_device_emulate', 'browser_viewport_test', 'browser_dark_mode',
    'browser_timezone_set', 'browser_user_agent_set', 'browser_geolocation_mock', 'browser_network_throttle',
    // Design Analysis (4)
    'browser_color_picker', 'browser_font_list', 'browser_selector_generator', 'browser_scroll_map',
    // Print & Export (2)
    'browser_print_preview', 'browser_page_to_pdf_data',
    // Dialog & Security (3)
    'browser_dialog_handler', 'browser_captcha_detect', 'browser_permissions_check',
    // Browser APIs (5)
    'browser_alarm_create', 'browser_alarm_list', 'browser_alarm_clear', 'browser_alarm_events',
    'browser_notify',
    // PWA & Service Worker (2)
    'browser_indexeddb_list', 'browser_service_worker_info',
    // Downloads & History (2)
    'browser_download', 'browser_history_search',
    // Bookmarks (3)
    'browser_bookmark_list', 'browser_bookmark_create', 'browser_bookmark_delete',
    // Clipboard (2)
    'browser_clipboard_read', 'browser_clipboard_write',
    // Sessions (4)
    'browser_session_list', 'browser_session_close_all', 'browser_session_clone', 'browser_top_sites',
    // Screen Tools (5)
    'screen_capture', 'screen_click', 'screen_type', 'screen_key', 'screen_scroll',
    // WebSocket Monitor (1)
    'browser_websocket_monitor',
    // Fetch Intercept (1)
    'browser_fetch_intercept',
  ];

  it('includes all expected tools', () => {
    const names = new Set(tools.map((t) => t.name));
    for (const expected of expectedTools) {
      expect(names, `Missing tool: ${expected}`).toContain(expected);
    }
  });

  it('no unexpected tools beyond expected list', () => {
    const expectedSet = new Set(expectedTools);
    const actual = tools.map((t) => t.name);
    for (const name of actual) {
      expect(expectedSet, `Unexpected tool not in expected list: ${name}`).toContain(name);
    }
  });

  it('sessionId prop included where expected', () => {
    const sessionTools = tools.filter(
      (t) => t.inputSchema.properties.sessionId !== undefined,
    );
    // Most tools should have sessionId (except session_list, session_close_all, screen_*)
    expect(sessionTools.length).toBeGreaterThan(100);
  });

  it('tabId prop included for interaction tools', () => {
    const tabTools = ['browser_snapshot', 'browser_click', 'browser_type', 'browser_hover', 'browser_scroll'];
    for (const name of tabTools) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.inputSchema.properties.tabId, `${name} missing tabId`).toBeDefined();
    }
  });

  it('frameId prop included for content-targeted tools', () => {
    const frameTools = ['browser_snapshot', 'browser_snapshot_diff', 'browser_html',
      'browser_click', 'browser_type', 'browser_select', 'browser_hover'];
    for (const name of frameTools) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.inputSchema.properties.frameId, `${name} missing frameId`).toBeDefined();
    }
  });
});

// ── Tools ↔ Handler Sync Test ─────────────────────────────
describe('tools-handler sync', () => {
  it('every tool in tools.ts has a matching case in server.ts handleTool', () => {
    const serverSrc = readFileSync(
      resolve(__dirname, '../../src/mcp/server.ts'),
      'utf-8',
    );
    // Extract case 'tool_name' patterns from the handleTool switch
    const casePattern = /case\s+'(browser_[a-z0-9_]+|screen_[a-z0-9_]+)'/g;
    const handlerNames = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = casePattern.exec(serverSrc)) !== null) {
      handlerNames.add(match[1]);
    }

    const toolNames = tools.map((t) => t.name);
    const missingHandlers: string[] = [];
    for (const name of toolNames) {
      if (!handlerNames.has(name)) {
        missingHandlers.push(name);
      }
    }
    expect(
      missingHandlers,
      `Tools defined in tools.ts but missing handler in server.ts: ${missingHandlers.join(', ')}`,
    ).toEqual([]);
  });

  it('every case in server.ts handleTool has a matching tool definition', () => {
    const serverSrc = readFileSync(
      resolve(__dirname, '../../src/mcp/server.ts'),
      'utf-8',
    );
    // Extract handleTool method's switch block (first switch after handleTool)
    const handleToolMatch = serverSrc.match(
      /private async handleTool[\s\S]*?switch\s*\(name\)\s*\{([\s\S]*?)\n\s{4}\}/,
    );
    expect(handleToolMatch, 'Could not find handleTool switch block').toBeTruthy();

    const switchBlock = handleToolMatch![1];
    const casePattern = /case\s+'(browser_[a-z0-9_]+|screen_[a-z0-9_]+)'/g;
    const handlerNames = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = casePattern.exec(switchBlock)) !== null) {
      handlerNames.add(match[1]);
    }

    const toolNames = new Set(tools.map((t) => t.name));
    const orphanHandlers: string[] = [];
    for (const name of handlerNames) {
      if (!toolNames.has(name)) {
        orphanHandlers.push(name);
      }
    }
    expect(
      orphanHandlers,
      `Handlers in server.ts with no tool definition: ${orphanHandlers.join(', ')}`,
    ).toEqual([]);
  });
});

// ── Documentation Sync Test ───────────────────────────────
describe('docs-tools sync', () => {
  it('README.md tool count matches tools.ts', () => {
    const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf-8');
    const match = readme.match(/## MCP Tools \((\d+)\)/);
    expect(match, 'README.md missing "## MCP Tools (N)" heading').toBeTruthy();
    expect(Number(match![1])).toBe(tools.length);
  });

  it('CLAUDE.md tool count matches tools.ts', () => {
    const claude = readFileSync(resolve(ROOT, 'CLAUDE.md'), 'utf-8');
    const match = claude.match(/(\d+) MCP tools across/);
    expect(match, 'CLAUDE.md missing "N MCP tools across" text').toBeTruthy();
    expect(Number(match![1])).toBe(tools.length);
  });
});
