/**
 * main.ts — Entry point for AI 마포구청장 MCP Server
 *
 * Supports:
 * - --stdio: stdio transport (Claude Desktop, local)
 * - default: Streamable HTTP transport (remote)
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function startStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[ai-mapo] MCP server running on stdio');
}

async function main() {
  if (process.argv.includes('--stdio')) {
    await startStdio();
  } else {
    // Default to stdio for simplicity in prototype
    await startStdio();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
