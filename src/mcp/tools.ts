// Read-only MCP tools over the ivelt.com phpBB forum.
//
// Each tool calls the matching IveltClient method to fetch raw HTML, hands that
// HTML to the matching parser, and returns the resulting records as JSON text.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { IveltClient, Parsers } from "../contract.js";
import { summarizePosts } from "../ivelt/profile.js";

/** Politeness cap on how many result pages profile_user will fetch. */
const PROFILE_MAX_PAGES = 40;
const PROFILE_DEFAULT_PAGES = 20;

/** Wrap any JSON-serializable value in the MCP text-content result shape. */
function json(d: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(d, null, 2) }] };
}

/**
 * Register the six read-only ivelt forum tools on the given MCP server.
 * The handlers fetch HTML via `client` and turn it into records via `parsers`.
 */
export function registerTools(
  server: McpServer,
  client: IveltClient,
  parsers: Parsers,
): void {
  server.registerTool(
    "search_posts",
    {
      title: "Search forum posts",
      description:
        "Search the ivelt.com forum for posts matching keywords and return the matching " +
        "topics/posts (title, link, forum, author, snippet, date). The forum is written in " +
        "Yiddish/Hebrew, so keywords may be Yiddish or English (Hebrew-script search terms " +
        "generally match best). NOTE: the forum search ignores words shorter than 4 letters " +
        "and very common words, so single short/common terms return nothing — use longer, " +
        "more specific keywords. To find topics a USER started, use topics_by_author instead. " +
        "Read-only. Use the optional 1-based `page` for more results.",
      inputSchema: {
        keywords: z.string(),
        page: z.number().int().positive().optional(),
      },
    },
    async ({ keywords, page }) =>
      json(parsers.parseSearch(await client.search(keywords, page))),
  );

  server.registerTool(
    "topics_by_author",
    {
      title: "Topics started by a user",
      description:
        "List the forum topics STARTED (opened) by a given ivelt.com user, by their exact " +
        "username (Yiddish/Hebrew usernames are fine). Returns each topic's title, link, and " +
        "author. This is the reliable way to count or list a user's own topics — unlike " +
        "search_posts it is not affected by the min-word-length / common-word rules. " +
        "Read-only. Use the optional 1-based `page` to page through users with many topics.",
      inputSchema: {
        author: z.string(),
        page: z.number().int().positive().optional(),
      },
    },
    async ({ author, page }) =>
      json(parsers.parseSearch(await client.searchAuthorTopics(author, page))),
  );

  server.registerTool(
    "posts_by_author",
    {
      title: "Posts by a user (with total count)",
      description:
        "List a user's forum posts (their replies AND topic-starts) by exact username, and " +
        "report their TOTAL post count (תגובות) across the whole forum. Returns `totalPosts` " +
        "(the overall number) plus the posts on the requested page (title, link, forum, snippet, " +
        "date). This is how to answer 'how many posts has X written'. Content is Yiddish/Hebrew. " +
        "Read-only. Use the optional 1-based `page` to walk through all of a prolific user's posts.",
      inputSchema: {
        author: z.string(),
        page: z.number().int().positive().optional(),
      },
    },
    async ({ author, page }) => {
      const { total, posts } = parsers.parsePostSearch(
        await client.searchAuthorPosts(author, page),
      );
      return json({ author, totalPosts: total, page: page ?? 1, posts });
    },
  );

  server.registerTool(
    "profile_user",
    {
      title: "Profile a user (public activity)",
      description:
        "Build an activity/interest profile of an ivelt.com user from their PUBLIC posts only. " +
        "Auto-pages through their posts and returns: total post count, interests (post counts " +
        "per forum), most-engaged topics, an active-hours histogram (0-23, in the forum's " +
        "displayed clock) and active days of week, the date range of activity, and a sample of " +
        "posts with snippets. Uses only what the person posted publicly — it does NOT determine " +
        "real identity, address, or phone. Content is Yiddish/Hebrew. `maxPages` (default 20, " +
        "~25 posts/page) caps how many posts are analyzed for very prolific users.",
      inputSchema: {
        author: z.string(),
        maxPages: z.number().int().positive().max(PROFILE_MAX_PAGES).optional(),
      },
    },
    async ({ author, maxPages }) => {
      const cap = Math.min(maxPages ?? PROFILE_DEFAULT_PAGES, PROFILE_MAX_PAGES);
      const collected = [];
      const seen = new Set<string>();
      let total: number | null = null;
      let pagesFetched = 0;
      for (let page = 1; page <= cap; page++) {
        const { total: t, posts } = parsers.parsePostSearch(
          await client.searchAuthorPosts(author, page),
        );
        pagesFetched++;
        if (total === null) total = t;
        if (posts.length === 0) break;
        // Dedupe across pages (robust even if page boundaries overlap).
        let added = 0;
        for (const p of posts) {
          const key = p.url || `${p.topicId ?? ""}|${p.title}`;
          if (seen.has(key)) continue;
          seen.add(key);
          collected.push(p);
          added++;
        }
        if (added === 0) break; // no new posts -> done
        if (total !== null && collected.length >= total) break;
      }
      return json(summarizePosts(author, total, collected, pagesFetched));
    },
  );

  server.registerTool(
    "read_topic",
    {
      title: "Read a topic",
      description:
        "Read one page of posts from a single ivelt.com forum topic by its topic id " +
        "(the phpBB t= value, as a string). Returns the topic title, link, and the posts on " +
        "that page (author, date, plain-text body, permalink). Post content is in " +
        "Yiddish/Hebrew. Read-only. Use the optional 1-based `page` to page through long topics.",
      inputSchema: {
        topicId: z.string(),
        page: z.number().int().positive().optional(),
      },
    },
    async ({ topicId, page }) =>
      json(parsers.parseTopic(await client.getTopic(topicId, page))),
  );

  server.registerTool(
    "list_forums",
    {
      title: "List forums",
      description:
        "List all forum sections on the ivelt.com board index (id, title, link, description, " +
        "and the category each sits under). Use this to discover forum ids before calling " +
        "list_topics. Forum names are in Yiddish/Hebrew. Read-only; takes no inputs.",
      inputSchema: {},
    },
    async () => json(parsers.parseForumIndex(await client.getForumIndex())),
  );

  server.registerTool(
    "list_topics",
    {
      title: "List topics in a forum",
      description:
        "List the topics inside a single ivelt.com forum by its forum id (the phpBB f= value, " +
        "as a string). Returns each topic's id, title, link, author, reply/view counts, and " +
        "last-post time. Topic titles are in Yiddish/Hebrew. Read-only. Use the optional " +
        "1-based `page` to page through the forum.",
      inputSchema: {
        forumId: z.string(),
        page: z.number().int().positive().optional(),
      },
    },
    async ({ forumId, page }) =>
      json(parsers.parseForum(await client.getForum(forumId, page))),
  );

  server.registerTool(
    "my_notifications",
    {
      title: "My notifications",
      description:
        "Show the logged-in ivelt.com user's notifications (e.g. replies/quotes/mentions), " +
        "with notification text, link, time, and unread state. Notification text is in " +
        "Yiddish/Hebrew. Read-only; takes no inputs. NOTE: this requires login, which ivelt's " +
        "Cloudflare protection blocks for automated access — this tool will usually return an " +
        "error explaining that. The other tools (search, browse, read) work without login.",
      inputSchema: {},
    },
    async () => json(parsers.parseNotifications(await client.getNotifications())),
  );

  server.registerTool(
    "my_messages",
    {
      title: "My private messages",
      description:
        "Show the logged-in ivelt.com user's private-message inbox (subject, sender, sent " +
        "time, link, and unread state). Message subjects/senders are in Yiddish/Hebrew. " +
        "Read-only; takes no inputs and only reads the inbox — it never sends anything. " +
        "NOTE: this requires login, which ivelt's Cloudflare protection blocks for automated " +
        "access — this tool will usually return an error explaining that.",
      inputSchema: {},
    },
    async () => json(parsers.parsePrivateMessages(await client.getPrivateMessages())),
  );
}
