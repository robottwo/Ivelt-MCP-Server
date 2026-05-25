// MCP server entry point. Wires the HTTP client + parsers into the MCP server
// and serves it over stdio to Claude Desktop.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConfig } from "./config.js";
import { createIveltClient } from "./ivelt/client.js";
import { parsers } from "./ivelt/parse.js";
import { buildServer } from "./mcp/server.js";

async function main(): Promise<void> {
  const client = createIveltClient(getConfig());
  const server = buildServer(client, parsers);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("ivelt-mcp failed to start:", err);
  process.exit(1);
});
