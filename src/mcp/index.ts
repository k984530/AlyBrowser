#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AlyBrowserMCPServer } from './server';

async function main(): Promise<void> {
  const mcpServer = new AlyBrowserMCPServer();
  const transport = new StdioServerTransport();
  await mcpServer.server.connect(transport);
}

// Catch unhandled promise rejections — without this, the process silently exits
process.on('unhandledRejection', (reason) => {
  console.error('[aly-browser] Unhandled rejection:', reason instanceof Error ? reason.message : String(reason));
  // Do NOT exit — let the MCP server continue serving. The rejection is logged for debugging.
});

main().catch((err) => {
  console.error('Failed to start AlyBrowser MCP server:', err);
  process.exit(1);
});
