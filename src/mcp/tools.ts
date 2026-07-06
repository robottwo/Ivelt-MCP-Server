// Read-only MCP tools over a phpBB forum.
//
// Each tool calls the matching PhpbbClient method to fetch raw HTML, hands that
// HTML to the matching parser, and returns the resulting records as JSON text.
// Tool descriptions are templated with the configured site name so the same code
// serves any phpBB board. Site-specific guidance (language tips, login quirks,
// per-board conventions) belongs in the forum_guide knowledge base, not here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PhpbbConfig } from "../config.js";
import type { PhpbbClient, Parsers } from "../contract.js";
import { summarizePosts } from "../phpbb/profile.js";

/** Politeness cap on how many result pages profile_user will fetch. */
const PROFILE_MAX_PAGES = 40;
// Keep the default low: many boards throttle searches (often ~15s apart), so each
// extra page can add a wait. ~3 pages (~75 posts) is plenty for a character
// profile; callers can raise maxPages when they want a deeper sample.
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
 * A user's AUTHORITATIVE lifetime post count. The search-results count is filtered
 * to what an unauthenticated reader can see (it omits posts in restricted/trashed
 * forums), so it undercounts. The authoritative `user_posts` value is shown publicly
 * in the post-profile of any of their posts on a topic page — so we open one of their
 * posts and read it from there. Best-effort: returns null on any failure.
 */
async function authoritativePostCount(
  client: PhpbbClient,
  parsers: Parsers,
  posts: Array<{ url: string }>,
  author: string,
): Promise<number | null> {
  const withUrl = posts.find((p) => p.url);
  if (!withUrl) return null;
  try {
    const html = await client.getPostPage(withUrl.url);
    return parsers.parseAuthorPostCount(html, author);
  } catch {
    return null;
  }
}

/** Read the site knowledge base for the forum_guide tool: the file named by
 *  PHPBB_GUIDE_PATH (resolved against the process working directory) when set,
 *  otherwise the KNOWLEDGE.md that ships next to this server. */
function readGuide(guidePath: string): string {
  const path =
    guidePath && guidePath.trim() !== ""
      ? resolvePath(guidePath)
      : // KNOWLEDGE.md lives at the project root, two levels up from dist/mcp/.
        fileURLToPath(new URL("../../KNOWLEDGE.md", import.meta.url));
  return readFileSync(path, "utf8");
}

/**
 * Register the read-only forum tools on the given MCP server. Descriptions are
 * templated with `config.siteName`. The handlers fetch HTML via `client` and turn
 * it into records via `parsers`. Every handler is wrapped so thrown errors
 * (network/TLS/HTTP) surface as MCP error results, and the search tools explain
 * empty result sets via detectNotice.
 */
export function registerTools(
  server: McpServer,
  config: PhpbbConfig,
  client: PhpbbClient,
  parsers: Parsers,
): void {
  const site = config.siteName;

  server.registerTool(
    "search_posts",
    {
      title: "Search forum posts",
      description:
        `Search ${site} for posts matching keywords and return the matching ` +
        "topics/posts (title, link, forum, author, snippet, date). NOTE: phpBB search " +
        "ignores words shorter than 4 letters and very common words, so single " +
        "short/common terms may return nothing — use longer, more specific keywords. " +
        "To find topics a USER started, use topics_by_author instead. Read-only. " +
        "Returns `totalResults` (how many posts match) plus the matching posts on this " +
        "page (title, link, forum, author, snippet, date). Use the optional 1-based " +
        "`page` for more.",
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
        `List the forum topics STARTED (opened) by a given ${site} user, by their exact ` +
        "username. Returns each topic's title, link, author, and its reply/view counts — " +
        "so you can find which of a user's topics got the most VIEWS (sort the results by " +
        "`views`). The reliable way to count/list a user's own topics; unlike search_posts " +
        "it isn't affected by the min-word-length / common-word rules. Read-only. Use the " +
        "optional 1-based `page`.",
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
        "List a user's forum posts (replies AND topic-starts) by exact username, and report " +
        "their post counts. Returns `totalPosts` — the AUTHORITATIVE lifetime count — plus " +
        "`visiblePosts` (how many this unauthenticated reader can actually see) and " +
        "`hiddenFromScraper` (the difference: posts in restricted or trashed forums). A non-zero " +
        "`hiddenFromScraper` means the user is more active than the visible posts suggest — surface " +
        "that, don't hide it. Also returns the posts on the requested page (title, link, forum, " +
        "snippet, date). This answers 'how many posts has X written'. " +
        "Read-only. Use the optional 1-based `page` to walk a prolific user's posts. Pass " +
        "`keywords` to instead filter to that user's posts containing those words — then it " +
        "returns `matchingPosts` (the count for that filter) rather than lifetime totals.",
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

        if (keywords) {
          // Keyword-filtered: `total` is the count of MATCHING posts, not a lifetime total.
          return json({
            author,
            keywords,
            matchingPosts: total,
            page: page ?? 1,
            posts,
            ...(note ? { note } : {}),
          });
        }

        // Unfiltered: the search count is visibility-filtered (it omits posts in
        // restricted/trashed forums) and can undercount, so also read the user's
        // authoritative lifetime count and surface both, plus the gap.
        const authoritative =
          posts.length > 0 ? await authoritativePostCount(client, parsers, posts, author) : null;
        const visiblePosts = total;
        const out: Record<string, unknown> = {
          author,
          totalPosts: authoritative ?? visiblePosts,
          visiblePosts,
          page: page ?? 1,
          posts,
        };
        if (authoritative !== null && visiblePosts !== null) {
          out.hiddenFromScraper = authoritative - visiblePosts;
        }
        if (note) out.note = note;
        return json(out);
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
        'The best tool for "help me understand this nick." Builds a rounded portrait of a ' +
        `${site} user from their PUBLIC posts so you can write a strong character summary: ` +
        "their main interests and apparent expertise, the topics/causes they care about, their " +
        "tone and personality, how active they are and WHEN (active-hours histogram 0-23 + active " +
        "days, in the forum's clock), how long they've been around (date range), total post count, " +
        "topics started, most-engaged topics, and a sample of posts with snippets. " +
        "PRESENT IT OVERVIEW-FIRST: do not just dump numbers. Begin with a substantial, reasoned " +
        "OVERVIEW that YOU synthesize from the data, BROKEN INTO SHORT LABELED SECTIONS by theme " +
        '(e.g. "Interests & expertise", "Views & values", "Tone & personality", "Activity ' +
        'pattern") — easy to scan, not one long block. For each conclusion, give your reasoning ' +
        'AND back it with evidence: link the specific topic/post that supports it (e.g. "argues ' +
        'X — see [topic title](url); jokes about Y — see [topic title](url)"), drawing on the ' +
        "topTopics and the post snippets. THEN, below the overview, give the detailed drill-down " +
        "(totals, interests/forums, activity rhythm, top topics) and cite the post links you use. " +
        "For a fun, " +
        'engaging read, also add a short "just for fun" section — 3-5 lighthearted touches ' +
        "inferred from the data: a guessed daily rhythm (roughly when they seem to wake up / go " +
        'to sleep, read from the active-hours histogram) and playful analogies ("if this nick ' +
        "were a car/animal/app, they'd be ...\"). Clearly frame those as playful guesses from " +
        "their public posting pattern, not facts about the real person. " +
        "Scope is strictly the public posting PERSONA — it does NOT, and must not " +
        "be used to, determine the person's real-world identity, home location/address, or contact " +
        "info. `maxPages` (default 3, ~25 posts/page) caps how deep it samples; raise it for a " +
        "deeper profile of prolific users (slower, since some forums throttle searches).",
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
          topicsStarted = parsers.parsePostSearch(await client.searchAuthorTopics(author)).total;
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
        // Authoritative lifetime post count (the search totals are visibility-filtered
        // and can undercount). Best-effort, from a topic post-profile.
        const authoritative =
          collected.length > 0
            ? await authoritativePostCount(client, parsers, collected, author)
            : null;
        const summary = summarizePosts(
          author,
          authoritative ?? total,
          collected,
          pagesFetched,
          topicsStarted,
        );
        const extra: Record<string, unknown> = {};
        if (authoritative !== null) {
          extra.visiblePosts = total;
          if (total !== null) extra.hiddenFromScraper = authoritative - total;
        }
        // No public posts found: explain why (unknown user, login required, etc.).
        const note =
          collected.length === 0 && firstHtml !== null ? parsers.detectNotice(firstHtml) : null;
        return json({ ...summary, ...extra, ...(note ? { note } : {}) });
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
        `Read one page of posts from a single ${site} forum topic by its topic id ` +
        "(the phpBB t= value, as a string). Returns the topic title, link, and the posts on " +
        "that page (author, date, plain-text body, permalink). Read-only. Pages are " +
        "oldest-first, so the NEWEST posts are on the LAST page: read page 1 to get " +
        "`totalPages`, then request that page to see the most recent activity. Use the " +
        "optional 1-based `page` to page through long topics.",
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
        `List all forum sections on the ${site} board index (id, title, link, description, ` +
        "and the category each sits under). Use this to discover forum ids before calling " +
        "list_topics. Read-only; takes no inputs.",
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
        `List the topics inside a single ${site} forum by its forum id (the phpBB f= value, ` +
        "as a string). Returns each topic's id, title, link, author, reply/view counts, and " +
        "last-post time. Read-only. Use the optional " +
        '1-based `page` to page through the forum. Use `sort` to order topics: "recent" ' +
        '(default), "views" (most-viewed first), or "replies" (most-replied first) — so you ' +
        "can find the most-viewed topics in a forum.",
      inputSchema: {
        forumId: z.string(),
        page: z.number().int().positive().optional(),
        sort: z.enum(["recent", "views", "replies"]).optional(),
      },
    },
    async ({ forumId, page, sort }) => {
      try {
        return json(parsers.parseForum(await client.getForum(forumId, page, sort)));
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "forum_guide",
    {
      title: "Forum guide / knowledge base",
      description:
        `Returns this deployment's optional site knowledge base for ${site}: notes about how ` +
        "this particular forum works — vocabulary/acronyms, which subforums matter, login " +
        "quirks, a playbook of which tool answers which question, and known limitations. Read " +
        "this first for site-specific context. The content is whatever the operator put in the " +
        "server's KNOWLEDGE.md (or the file named by the PHPBB_GUIDE_PATH env var). Takes no inputs.",
      inputSchema: {},
    },
    async () => {
      try {
        return { content: [{ type: "text" as const, text: readGuide(config.guidePath) }] };
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: "Knowledge base not found. Provide one via KNOWLEDGE.md next to the server or the PHPBB_GUIDE_PATH env var. See the project README.",
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "my_notifications",
    {
      title: "My notifications",
      description:
        `Show the logged-in ${site} user's notifications (e.g. replies/quotes/mentions), ` +
        "with notification text, link, time, and unread state. Read-only; takes no inputs. " +
        "NOTE: this requires login, which some forums block for automated access — this tool " +
        "may return an error explaining that. The other tools (search, browse, read) work " +
        "without login.",
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
        `Show the logged-in ${site} user's private-message inbox (subject, sender, sent ` +
        "time, link, and unread state). Read-only; takes no inputs and only reads the inbox — " +
        "it never sends anything. NOTE: this requires login, which some forums block for " +
        "automated access — this tool may return an error explaining that.",
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
        `Check that ${site} is reachable and report whether the session is logged ` +
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
            ? "Forum reachable. Search/browse/read work without login. Login may be blocked by " +
              "the site (some forums block automated login), so my_notifications/my_messages " +
              "can be unavailable."
            : `Could not reach ${site} — check your network / that the server runs with ` +
              "--use-system-ca.",
        });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );
}
