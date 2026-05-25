// Builds the ivelt MCP server and registers the read-only tools on it.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IveltClient, Parsers } from "../contract.js";
import { registerTools } from "./tools.js";

/**
 * Build the ivelt MCP server, wiring the given client + parsers into the
 * read-only forum tools. index.ts connects it to a transport.
 */
export function buildServer(client: IveltClient, parsers: Parsers): McpServer {
  const server = new McpServer({ name: "ivelt", version: "1.0.0" });
  registerTools(server, client, parsers);
  return server;
}
