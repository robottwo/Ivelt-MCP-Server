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
// Keep the default low: ivelt throttles searches (~15s apart), so each extra page
// can add a wait. ~3 pages (~75 posts) is plenty for a character profile; callers
// can raise maxPages when they want a deeper sample and don't mind waiting.
const PROFILE_DEFAULT_PAGES = 3;

/** Wrap any JSON-serializable value in the MCP text-content result shape. */
function json(d: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(d, null, 2) }] };
}

/** Report a failure as an MCP error result so the user sees the reason
 *  (e.g. a network/TLS/HTTP error) instead of a silent empty response. */
function fail(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

/**
 * Register the read-only ivelt forum tools on the given MCP server.
 * The handlers fetch HTML via `client` and turn it into records via `parsers`.
 * Every handler is wrapped so thrown errors (network/TLS/HTTP) surface as MCP
 * error results, and the search tools explain empty result sets via detectNotice.
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
        "Read-only. Returns `totalResults` (how many posts match) plus the matching posts on " +
        "this page (title, link, forum, author, snippet, date). Use the optional 1-based `page` for more.",
      inputSchema: {
        keywords: z.string(),
        page: z.number().int().positive().optional(),
      },
    },
    async ({ keywords, page }) => {
      try {
        const html = await client.search(keywords, page);
        const { total, posts } = parsers.parsePostSearch(html);
        // No matches: explain why (too-short/common words, flood control, etc.).
        const note = posts.length === 0 ? parsers.detectNotice(html) : null;
        return json({ totalResults: total, results: posts, ...(note ? { note } : {}) });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
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
    async ({ author, page }) => {
      try {
        const html = await client.searchAuthorTopics(author, page);
        const results = parsers.parseSearch(html);
        // No topics found: explain why (unknown user, login required, etc.).
        const note = results.length === 0 ? parsers.detectNotice(html) : null;
        return json(note ? { results, note } : results);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
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
        "Read-only. Use the optional 1-based `page` to walk through all of a prolific user's posts. " +
        "Optionally pass `keywords` to filter to that user's posts containing those words " +
        "(e.g. find what a user said about a topic).",
      inputSchema: {
        author: z.string(),
        page: z.number().int().positive().optional(),
        keywords: z.string().optional(),
      },
    },
    async ({ author, page, keywords }) => {
      try {
        const html = await client.searchAuthorPosts(author, page, keywords);
        const { total, posts } = parsers.parsePostSearch(html);
        // No posts found: explain why (unknown user, login required, etc.).
        const note = posts.length === 0 ? parsers.detectNotice(html) : null;
        return json({
          author,
          totalPosts: total,
          page: page ?? 1,
          posts,
          ...(note ? { note } : {}),
        });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "profile_user",
    {
      title: "Profile a user (public activity)",
      description:
        "The best tool for \"help me understand this nick.\" Builds a rounded portrait of an " +
        "ivelt.com user from their PUBLIC posts so you can write a strong character summary: " +
        "their main interests and apparent expertise, the topics/causes they care about, their " +
        "tone and personality, how active they are and WHEN (active-hours histogram 0-23 + active " +
        "days, in the forum's clock), how long they've been around (date range), total post count, " +
        "topics started, most-engaged topics, and a sample of posts with snippets. Synthesize all " +
        "of this into a readable summary and cite the post links you draw from. Content is " +
        "Yiddish/Hebrew. Scope is strictly the public posting PERSONA — it does NOT, and must not " +
        "be used to, determine the person's real-world identity, home location/address, or contact " +
        "info. `maxPages` (default 3, ~25 posts/page) caps how deep it samples; raise it for a " +
        "deeper profile of prolific users (slower, since the forum throttles searches ~15s apart).",
      inputSchema: {
        author: z.string(),
        maxPages: z.number().int().positive().max(PROFILE_MAX_PAGES).optional(),
      },
    },
    async ({ author, maxPages }) => {
      try {
        const cap = Math.min(maxPages ?? PROFILE_DEFAULT_PAGES, PROFILE_MAX_PAGES);

        // How many topics the user has STARTED (the "found N results" heading on
        // the topics-search page). Fetched FIRST — a single request — so it isn't
        // lost if the post paging below trips the forum's search throttle.
        // Best-effort: a failure here must not sink the whole profile.
        let topicsStarted: number | null = null;
        try {
          topicsStarted = parsers.parsePostSearch(
            await client.searchAuthorTopics(author),
          ).total;
        } catch {
          /* leave null — the post-based profile below is the primary result */
        }

        const collected = [];
        const seen = new Set<string>();
        let total: number | null = null;
        let pagesFetched = 0;
        // Raw HTML of the first page, kept so we can explain an empty profile.
        let firstHtml: string | null = null;
        for (let page = 1; page <= cap; page++) {
          const html = await client.searchAuthorPosts(author, page);
          if (firstHtml === null) firstHtml = html;
          const { total: t, posts } = parsers.parsePostSearch(html);
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
        const summary = summarizePosts(author, total, collected, pagesFetched, topicsStarted);
        // No public posts found: explain why (unknown user, login required, etc.).
        const note = collected.length === 0 && firstHtml !== null
          ? parsers.detectNotice(firstHtml)
          : null;
        return json(note ? { ...summary, note } : summary);
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
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
    async ({ topicId, page }) => {
      try {
        return json(parsers.parseTopic(await client.getTopic(topicId, page)));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
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
    async () => {
      try {
        return json(parsers.parseForumIndex(await client.getForumIndex()));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
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
    async ({ forumId, page }) => {
      try {
        return json(parsers.parseForum(await client.getForum(forumId, page)));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
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
    async () => {
      try {
        return json(parsers.parseNotifications(await client.getNotifications()));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
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
    async () => {
      try {
        return json(parsers.parsePrivateMessages(await client.getPrivateMessages()));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "health_check",
    {
      title: "Health check",
      description:
        "Check that the ivelt.com forum is reachable and report whether the session is logged " +
        "in. Use this first if other tools return errors or empty results.",
      inputSchema: {},
    },
    async () => {
      try {
        const { reachable, loggedIn } = await client.checkConnectivity();
        return json({
          reachable,
          loggedIn,
          note: reachable
            ? "Forum reachable. Search/browse/read work without login. Login is blocked by the " +
              "site's Cloudflare protection, so my_notifications/my_messages are unavailable."
            : "Could not reach ivelt.com — check your network / that the server runs with " +
              "--use-system-ca.",
        });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );
}
