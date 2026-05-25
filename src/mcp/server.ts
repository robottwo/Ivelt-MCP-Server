// Builds the ivelt MCP server and registers the read-only tools on it.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IveltClient, Parsers } from "../contract.js";
import { registerTools } from "./tools.js";

/**
 * Build the ivelt MCP server, wiring the given client + parsers into the
 * read-only forum tools. index.ts connects it to a transport.
 */
export function buildServer(client: IveltClient, parsers: Parsers): McpServer {
  const server = new McpServer(
    { name: "ivelt", version: "1.0.0" },
    {
      instructions:
        "This forum is in Yiddish/Hebrew. If you're unsure about terms, how the forum " +
        "works, or which tool to use, call `forum_guide` first — it returns a glossary, " +
        "forum mechanics, and a tool playbook. Always cite your sources: when you answer " +
        "using these tools, link the source for what you report — each result/post/topic " +
        "has a `url` field. Keep it brief and readable: short inline links (e.g. the topic " +
        "title linking to its url), not a dump of raw URLs or a link for every line.",
    },
  );
  registerTools(server, client, parsers);
  return server;
}
