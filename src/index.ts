// MCP server entry point. Wires the HTTP client + parsers into the MCP server
// and serves it over stdio to the MCP client.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConfig } from "./config.js";
import { createPhpbbClient } from "./phpbb/client.js";
import { createParsers } from "./phpbb/parse.js";
import { buildServer } from "./mcp/server.js";

async function main(): Promise<void> {
  const config = getConfig();
  const client = createPhpbbClient(config);
  const server = buildServer(config, client, createParsers(config.baseUrl));
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("phpbb-mcp failed to start:", err);
  process.exit(1);
});
