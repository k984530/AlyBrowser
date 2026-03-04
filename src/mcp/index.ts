#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AlyBrowserMCPServer } from './server';

async function main(): Promise<void> {
  const mcpServer = new AlyBrowserMCPServer();
  const transport = new StdioServerTransport();
  await mcpServer.server.connect(transport);
}

main().catch((err) => {
  console.error('Failed to start AlyBrowser MCP server:', err);
  process.exit(1);
});
