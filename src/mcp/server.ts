// Builds the configurable phpBB MCP server and registers the read-only tools on it.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PhpbbConfig } from "../config.js";
import type { PhpbbClient, Parsers } from "../contract.js";
import { registerTools } from "./tools.js";

/**
 * Build the phpBB MCP server, wiring the given client + parsers into the
 * read-only forum tools. index.ts connects it to a transport.
 */
export function buildServer(config: PhpbbConfig, client: PhpbbClient, parsers: Parsers): McpServer {
  const server = new McpServer(
    { name: config.siteName, version: "1.0.0" },
    {
      instructions:
        `You are connected to the phpBB forum ${config.siteName}. ` +
        "Use `forum_guide` first if you need site-specific context or workflow guidance. " +
        "Always cite your sources when answering from forum data — each result/post/topic has a `url` field. " +
        "Keep citations readable: short inline links, not raw URL dumps. " +
        "If the forum content is in a language other than the user's, translate or summarize clearly in the user's language.",
    },
  );
  registerTools(server, config, client, parsers);
  return server;
}
