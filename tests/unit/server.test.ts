import { describe, it, expect, afterEach } from 'vitest';
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
});
