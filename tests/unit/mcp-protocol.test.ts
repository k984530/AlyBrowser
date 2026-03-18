import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';

/**
 * Tests the MCP server over stdio using the actual JSON-RPC protocol.
 * Verifies the full stack: entry point → server → tool registration → tool execution.
 */
describe('MCP Protocol (stdio)', () => {
  let child: ChildProcess | null = null;

  function startServer(): ChildProcess {
    const bin = path.join(__dirname, '../../dist/mcp/index.js');
    child = spawn('node', [bin], { stdio: ['pipe', 'pipe', 'pipe'] });
    return child;
  }

  function send(proc: ChildProcess, msg: Record<string, unknown>): void {
    proc.stdin!.write(JSON.stringify(msg) + '\n');
  }

  function collectResponses(proc: ChildProcess, timeoutMs: number): Promise<Map<number, any>> {
    return new Promise((resolve) => {
      let stdout = '';
      proc.stdout!.on('data', (d) => { stdout += d.toString(); });
      setTimeout(() => {
        const responses = new Map<number, any>();
        for (const line of stdout.split('\n').filter(Boolean)) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.id !== undefined) responses.set(parsed.id, parsed);
          } catch {}
        }
        resolve(responses);
      }, timeoutMs);
    });
  }

  afterEach(() => {
    if (child && !child.killed) {
      child.kill();
      child = null;
    }
  });

  it('completes initialize handshake', async () => {
    const proc = startServer();
    send(proc, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
    });

    const responses = await collectResponses(proc, 2500);
    const init = responses.get(1);
    expect(init).toBeDefined();
    expect(init.result.serverInfo.name).toBe('aly-browser');
    expect(init.result.serverInfo.version).toBe('3.0.1');
    expect(init.result.capabilities.tools).toBeDefined();
    expect(init.result.instructions).toBeTruthy();
  });

  it('lists all 124 tools', async () => {
    const proc = startServer();

    send(proc, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
    });

    setTimeout(() => {
      send(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });
      send(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    }, 300);

    const responses = await collectResponses(proc, 2500);
    const list = responses.get(2);
    expect(list).toBeDefined();
    expect(list.result.tools).toHaveLength(124);

    const names = list.result.tools.map((t: any) => t.name);
    expect(names).toContain('browser_launch');
    expect(names).toContain('browser_snapshot');
    expect(names).toContain('browser_session_list');
  });

  it('executes browser_session_list without Chrome', async () => {
    const proc = startServer();

    send(proc, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
    });

    setTimeout(() => {
      send(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });
      send(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'browser_session_list', arguments: {} },
      });
    }, 300);

    const responses = await collectResponses(proc, 2500);
    const result = responses.get(2);
    expect(result).toBeDefined();
    expect(result.result.content[0].text).toContain('No active browser sessions');
  });

  it('returns error for tool requiring session', async () => {
    const proc = startServer();

    send(proc, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
    });

    setTimeout(() => {
      send(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });
      send(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'browser_snapshot', arguments: {} },
      });
    }, 300);

    const responses = await collectResponses(proc, 2500);
    const result = responses.get(2);
    expect(result).toBeDefined();
    expect(result.result.content[0].text).toContain('No browser session');
    expect(result.result.isError).toBe(true);
  });

  it('executes browser_session_close_all without Chrome', async () => {
    const proc = startServer();

    send(proc, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
    });

    setTimeout(() => {
      send(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });
      send(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'browser_session_close_all', arguments: {} },
      });
    }, 300);

    const responses = await collectResponses(proc, 2500);
    const result = responses.get(2);
    expect(result).toBeDefined();
    expect(result.result.isError).toBeFalsy();
  });

  it('returns error for unknown tool', async () => {
    const proc = startServer();

    send(proc, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
    });

    setTimeout(() => {
      send(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });
      send(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'browser_nonexistent_tool', arguments: {} },
      });
    }, 300);

    const responses = await collectResponses(proc, 2500);
    const result = responses.get(2);
    expect(result).toBeDefined();
    expect(result.result.content[0].text).toContain('Unknown tool');
    expect(result.result.isError).toBe(true);
  });

  it('returns error for multiple session-requiring tools', async () => {
    const proc = startServer();

    send(proc, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
    });

    setTimeout(() => {
      send(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });
      // Test several tools that require a browser session
      send(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'browser_click', arguments: { ref: '@e1' } },
      });
      send(proc, {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'browser_navigate', arguments: { url: 'https://example.com' } },
      });
      send(proc, {
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'browser_eval', arguments: { expression: '1+1' } },
      });
    }, 300);

    const responses = await collectResponses(proc, 3000);
    for (const id of [2, 3, 4]) {
      const result = responses.get(id);
      expect(result, `Response for id ${id} missing`).toBeDefined();
      expect(result.result.content[0].text).toContain('No browser session');
      expect(result.result.isError).toBe(true);
    }
  });

  it('tools/list returns valid schema for each tool', async () => {
    const proc = startServer();

    send(proc, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
    });

    setTimeout(() => {
      send(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });
      send(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    }, 300);

    const responses = await collectResponses(proc, 2500);
    const list = responses.get(2);
    expect(list).toBeDefined();

    for (const tool of list.result.tools) {
      expect(tool.name, 'tool name must be string').toEqual(expect.any(String));
      expect(tool.description.length, `${tool.name} description too short`).toBeGreaterThan(10);
      expect(tool.inputSchema.type, `${tool.name} schema type must be object`).toBe('object');
      expect(tool.inputSchema.properties, `${tool.name} missing properties`).toBeDefined();
    }
  });

  it('server handles sequential tool calls correctly', async () => {
    const proc = startServer();

    send(proc, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      },
    });

    setTimeout(() => {
      send(proc, { jsonrpc: '2.0', method: 'notifications/initialized' });
      // First: list sessions (success)
      send(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'browser_session_list', arguments: {} },
      });
    }, 500);

    setTimeout(() => {
      // Second: close all (success)
      send(proc, {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'browser_session_close_all', arguments: {} },
      });
    }, 1000);

    setTimeout(() => {
      // Third: snapshot (error — no session)
      send(proc, {
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'browser_snapshot', arguments: {} },
      });
    }, 1500);

    const responses = await collectResponses(proc, 4000);

    const r2 = responses.get(2);
    expect(r2).toBeDefined();
    expect(r2.result.isError).toBeFalsy();

    const r3 = responses.get(3);
    expect(r3).toBeDefined();
    expect(r3.result.isError).toBeFalsy();

    const r4 = responses.get(4);
    expect(r4).toBeDefined();
    expect(r4.result.isError).toBe(true);
  });
});
