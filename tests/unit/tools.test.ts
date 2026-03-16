import { describe, it, expect } from 'vitest';
import { tools, type ToolDefinition } from '../../src/mcp/tools';

describe('tools definitions', () => {
  it('exports a non-empty array', () => {
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
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

  const expectedTools = [
    'browser_launch', 'browser_navigate', 'browser_back', 'browser_forward', 'browser_close',
    'browser_snapshot', 'browser_html', 'browser_eval',
    'browser_click', 'browser_type', 'browser_select', 'browser_hover', 'browser_scroll',
    'browser_wait', 'browser_wait_for_stable',
    'browser_tab_list', 'browser_tab_new', 'browser_tab_close', 'browser_tab_switch',
    'browser_cookie_get', 'browser_cookie_set', 'browser_cookie_delete',
    'browser_download', 'browser_history_search',
    'browser_alarm_create', 'browser_alarm_list', 'browser_alarm_clear', 'browser_alarm_events',
    'browser_storage_get', 'browser_storage_set',
    'browser_notify',
    'browser_bookmark_list', 'browser_bookmark_create', 'browser_bookmark_delete',
    'browser_sleep',
    'browser_learn', 'browser_get_knowledge',
    'browser_top_sites',
    'browser_clipboard_read', 'browser_clipboard_write',
    'browser_session_list', 'browser_session_close_all',
  ];

  it('includes all expected tools', () => {
    const names = new Set(tools.map((t) => t.name));
    for (const expected of expectedTools) {
      expect(names, `Missing tool: ${expected}`).toContain(expected);
    }
  });

  it('sessionId prop included where expected', () => {
    const sessionTools = tools.filter(
      (t) => t.inputSchema.properties.sessionId !== undefined,
    );
    // Most tools should have sessionId (except sleep, session_list, session_close_all)
    expect(sessionTools.length).toBeGreaterThan(20);
  });

  it('tabId prop included for interaction tools', () => {
    const tabTools = ['browser_snapshot', 'browser_click', 'browser_type', 'browser_hover', 'browser_scroll'];
    for (const name of tabTools) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.inputSchema.properties.tabId, `${name} missing tabId`).toBeDefined();
    }
  });
});
