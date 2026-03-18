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

    const responses = await collectResponses(proc, 1500);
    const init = responses.get(1);
    expect(init).toBeDefined();
    expect(init.result.serverInfo.name).toBe('aly-browser');
    expect(init.result.serverInfo.version).toBe('2.5.0');
    expect(init.result.capabilities.tools).toBeDefined();
    expect(init.result.instructions).toBeTruthy();
  });

  it('lists all 49 tools', async () => {
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

    const responses = await collectResponses(proc, 1500);
    const list = responses.get(2);
    expect(list).toBeDefined();
    expect(list.result.tools).toHaveLength(112);

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

    const responses = await collectResponses(proc, 1500);
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

    const responses = await collectResponses(proc, 1500);
    const result = responses.get(2);
    expect(result).toBeDefined();
    expect(result.result.content[0].text).toContain('No browser session');
    expect(result.result.isError).toBe(true);
  });
});
