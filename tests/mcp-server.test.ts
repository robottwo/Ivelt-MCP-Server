import test from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { buildServer } from "../src/mcp/server.ts";
import type { PhpbbConfig } from "../src/config.ts";
import type { PhpbbClient, Parsers } from "../src/contract.ts";

const client: PhpbbClient = {
  login: async () => {},
  getForumIndex: async () => "",
  getForum: async () => "",
  getTopic: async () => "",
  search: async () => "",
  searchAuthorTopics: async () => "",
  searchAuthorPosts: async () => "",
  getNotifications: async () => "",
  getPrivateMessages: async () => "",
  getPostPage: async () => "",
  checkConnectivity: async () => ({ reachable: true, loggedIn: false }),
};

const parsers: Parsers = {
  parseForumIndex: () => [],
  parseForum: () => [],
  parseTopic: () => ({ id: "", title: "", url: "", posts: [], page: 1, totalPages: 1 }),
  parseSearch: () => [],
  parsePostSearch: () => ({ total: 0, posts: [] }),
  parseAuthorPostCount: () => null,
  detectNotice: () => null,
  parseNotifications: () => [],
  parsePrivateMessages: () => [],
};

const config: PhpbbConfig = {
  siteName: "Example Forum",
  baseUrl: "https://forum.example.com/forum",
  username: "",
  password: "",
  postsPerPage: 25,
  topicsPerPage: 25,
  guidePath: "",
};

test("buildServer uses configurable site metadata instead of a hard-coded identity", () => {
  const server = buildServer(config, client, parsers);
  assert.ok(server);
});

// Connect an in-memory client to the built server so we can introspect the real
// registered tool list and the server-instructions the way an MCP client sees them.
async function connectAndIntrospect(cfg: PhpbbConfig) {
  const server = buildServer(cfg, client, parsers);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  const instructions = mcpClient.getInstructions() ?? "";
  const { tools } = await mcpClient.listTools();
  await mcpClient.close();
  return { instructions, tools };
}

test('no registered tool name/description or server instructions mention "ivelt"', async () => {
  const { instructions, tools } = await connectAndIntrospect(config);

  assert.ok(tools.length > 0, "expected at least one registered tool");
  assert.doesNotMatch(instructions, /ivelt/i, "server instructions must not mention ivelt");

  for (const tool of tools) {
    assert.doesNotMatch(tool.name, /ivelt/i, `tool name mentions ivelt: ${tool.name}`);
    assert.doesNotMatch(
      tool.description ?? "",
      /ivelt/i,
      `tool description mentions ivelt: ${tool.name}`,
    );
  }
});

test("tool descriptions are templated with the configured site name", async () => {
  const { tools } = await connectAndIntrospect({ ...config, siteName: "Acme Boards" });
  const searchPosts = tools.find((t) => t.name === "search_posts");
  assert.ok(searchPosts, "search_posts tool should be registered");
  assert.match(searchPosts?.description ?? "", /Acme Boards/);
});
