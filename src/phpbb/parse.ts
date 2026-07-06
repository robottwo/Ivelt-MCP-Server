// HTML parsers for phpBB forums.
//
// Pure HTML -> typed-record functions. No network. Each takes the raw HTML
// string returned by the matching PhpbbClient method and returns the record
// type(s) from ../types.js. NONE of these functions may throw on empty/garbage/
// logged-out input — they return [] (or, for parseTopic, a best-effort empty record).
//
// The only per-instance state is the base URL used to resolve relative links; it
// is captured inside createParsers(baseUrl) and threaded explicitly into the
// base-dependent functions, so multiple parser instances (e.g. several forums in
// one process) never share a mutable global.
//
// Key phpBB/prosilver selectors:
//   - forums use  a.forumtitle  (board index)
//   - topics use  a.topictitle  (forum listing / search / active-topics)
//   - posts are   div.post  containing  .postbody  with  p.author  and  .content
//
// All relative links are resolved to absolute forum URLs
// and any per-session  sid=  query param is stripped from extracted URLs.

import * as cheerio from "cheerio";
import type { Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import type {
  Forum,
  TopicSummary,
  Topic,
  Post,
  Attachment,
  SearchResult,
  AuthorPostsResult,
  SearchNotice,
  Notification,
  PrivateMessage,
} from "../types.js";
import type { Parsers } from "../contract.js";

/** Normalize a configured base URL into a form suitable for URL resolution:
 *  no trailing slash duplication, exactly one trailing slash so relative links
 *  like "./viewforum.php?f=6" resolve against the forum directory. */
function normalizeBaseUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/`;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Load HTML into cheerio; returns null on empty/invalid input (so callers
 *  can bail out to an empty result instead of throwing). */
function loadHtml(html: string): cheerio.CheerioAPI | null {
  if (typeof html !== "string" || html.trim() === "") return null;
  try {
    return cheerio.load(html);
  } catch {
    return null;
  }
}

/** Resolve a possibly-relative href to an absolute forum URL (against `base`)
 *  and strip the per-session  sid  param. Returns null when there is no usable href. */
function absoluteUrl(base: string, href: string | undefined | null): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("javascript:")) {
    return null;
  }
  try {
    const url = new URL(trimmed, base);
    url.searchParams.delete("sid");
    return url.toString();
  } catch {
    return null;
  }
}

/** Extract a numeric phpBB id (t / f / p) from a URL's query string. The id can
 *  also appear in the fragment (e.g. viewtopic.php?p=123#p123). */
function idFromUrl(
  base: string,
  href: string | undefined | null,
  param: "t" | "f" | "p",
): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    const fromQuery = url.searchParams.get(param);
    if (fromQuery && /^\d+$/.test(fromQuery)) return fromQuery;
    // Fallback: scan the raw string (covers odd encodings / fragments).
  } catch {
    /* fall through to regex */
  }
  const re = new RegExp(`[?&#]${param}=?p?(\\d+)`);
  const m = href.match(re);
  return m ? m[1] : null;
}

/** Collapse runs of whitespace into single spaces and trim. */
function cleanText(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim();
}

/** Parse the first integer found in a string (e.g. "179 תגובות" -> 179). */
function firstInt(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/[, ]/g, "").match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/**
 * Render a post-body element's inner content as readable plain text: HTML tags
 * stripped, runs of whitespace collapsed, but line breaks preserved between
 * block elements and at <br>. Works on the .content node of a post.
 */
function readableText(el: AnyNode): string {
  const blockTags = new Set([
    "p", "div", "br", "li", "tr", "blockquote", "h1", "h2", "h3",
    "h4", "h5", "h6", "pre",
  ]);
  let out = "";

  const walk = (node: AnyNode): void => {
    if (node.type === "text") {
      out += (node as unknown as { data: string }).data ?? "";
      return;
    }
    if (node.type === "tag") {
      const tag = (node as unknown as { name: string }).name.toLowerCase();
      if (tag === "br") {
        out += "\n";
        return;
      }
      const isBlock = blockTags.has(tag);
      if (isBlock && out !== "" && !out.endsWith("\n")) out += "\n";
      const children = (node as unknown as { children?: AnyNode[] }).children ?? [];
      for (const child of children) walk(child);
      if (isBlock && !out.endsWith("\n")) out += "\n";
    }
  };

  const root = el as unknown as { children?: AnyNode[] };
  for (const child of root.children ?? []) walk(child);

  // Normalize: trim each line, collapse intra-line whitespace, drop excess
  // blank lines, and trim the whole thing.
  const lines = out
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim());
  const collapsed: string[] = [];
  for (const line of lines) {
    if (line === "" && (collapsed.length === 0 || collapsed[collapsed.length - 1] === "")) {
      continue;
    }
    collapsed.push(line);
  }
  return collapsed.join("\n").trim();
}

/** Derive a readable file name from a URL: the last path segment, else a
 *  recognizable query value, else a generic fallback. */
function fileNameFromUrl(base: string, rawUrl: string): string {
  try {
    const url = new URL(rawUrl, base);
    const segment = url.pathname.split("/").filter(Boolean).pop();
    if (segment && segment !== "file.php") return decodeURIComponent(segment);
    // download/file.php uses query params (id=, avatar=) rather than a path name.
    const idParam = url.searchParams.get("id") ?? url.searchParams.get("avatar");
    if (idParam) return decodeURIComponent(idParam);
  } catch {
    /* fall through */
  }
  return "attachment";
}

/** True when an image is a phpBB emoticon/smiley rather than real content:
 *  a smilies path, the `smilies` class, or tiny intrinsic dimensions. */
function isSmiley($img: Cheerio<AnyNode>): boolean {
  const src = $img.attr("src") ?? "";
  if (/\/images\/smilies(\/|$)/i.test(src)) return true;
  if (($img.attr("class") ?? "").split(/\s+/).includes("smilies")) return true;
  const w = parseInt($img.attr("width") ?? "", 10);
  const h = parseInt($img.attr("height") ?? "", 10);
  if (Number.isFinite(w) && w > 0 && w <= 20) return true;
  if (Number.isFinite(h) && h > 0 && h <= 20) return true;
  return false;
}

/** Collect a post's attachments — download links and inline images — from its
 *  `div.post` element, de-duplicated by absolute URL. Avatars and emoticons are
 *  excluded; only files attached to (and images embedded in) the post body count. */
function collectAttachments(
  base: string,
  $: cheerio.CheerioAPI,
  $post: Cheerio<AnyNode>,
): Attachment[] {
  const attachments: Attachment[] = [];
  const seen = new Set<string>();

  const add = (rawUrl: string | null | undefined, rawName: string): void => {
    const url = absoluteUrl(base, rawUrl);
    if (!url || seen.has(url)) return;
    seen.add(url);
    const name = cleanText(rawName) || cleanText(fileNameFromUrl(base, url)) || "attachment";
    attachments.push({ name, url });
  };

  // Download links: attachment boxes plus any body link to download/file.php.
  // Scoped to the post body so profile avatars (also download/file.php) are skipped.
  const $body = $post.find(".postbody").first();
  const $bodyScope = $body.length ? $body : $post;
  $bodyScope
    .find('.attachbox a[href*="download/file.php"], dl.attachbox a[href*="download/file.php"], a.postlink[href*="download/file.php"], a[href*="download/file.php"]')
    .each((_i, a) => {
      const $a = $(a);
      add($a.attr("href"), $a.text());
    });

  // Inline images embedded in the post content, skipping emoticons/smilies.
  $post.find(".content img[src]").each((_i, img) => {
    const $img = $(img);
    if (isSmiley($img)) return;
    const src = $img.attr("src") ?? "";
    add(src, fileNameFromUrl(base, absoluteUrl(base, src) ?? src));
  });

  return attachments;
}

// ---------------------------------------------------------------------------
// parseForumIndex — board index (index.php)
// ---------------------------------------------------------------------------

function parseForumIndex(base: string, html: string): Forum[] {
  const $ = loadHtml(html);
  if (!$) return [];
  const forums: Forum[] = [];
  const seen = new Set<string>();

  // Each category is a `.forabg` block; its heading is the `li.header` link/text,
  // and the forums under it are `a.forumtitle` anchors inside `li.row` items.
  $(".forabg").each((_i, block) => {
    const $block = $(block);
    const category =
      cleanText($block.find("ul.topiclist > li.header dl dt").first().text()) || null;

    $block.find("a.forumtitle").each((_j, a) => {
      const $a = $(a);
      const href = $a.attr("href");
      const url = absoluteUrl(base, href);
      const id = idFromUrl(base, href, "f");
      const title = cleanText($a.text());
      if (!url || !id || title === "") return;
      if (seen.has(id)) return;
      seen.add(id);

      // Description: the bare text node that follows the forumtitle's <br>,
      // before any moderators / subforum markup. We read the parent
      // .list-inner text, strip the title, and take the first meaningful line.
      let description: string | null = null;
      const dtText = $a.parent().contents();
      // Walk siblings after the anchor until we hit a <strong> or <a>.
      let desc = "";
      let started = false;
      dtText.each((_k, node) => {
        if (node === a) {
          started = true;
          return;
        }
        if (!started) return;
        if (node.type === "text") {
          desc += (node as unknown as { data: string }).data ?? "";
        } else if (node.type === "tag") {
          const name = (node as unknown as { name: string }).name.toLowerCase();
          if (name === "br") {
            desc += "\n";
          } else {
            // Stop at the first element (strong/a/div) after the description text.
            return false;
          }
        }
        return undefined;
      });
      const firstLine = desc
        .split("\n")
        .map((l) => cleanText(l))
        .find((l) => l !== "");
      if (firstLine) description = firstLine;

      forums.push({ id, title, url, description, category });
    });
  });

  // Fallback: if the category blocks didn't match (markup drift), grab every
  // forumtitle anchor on the page.
  if (forums.length === 0) {
    $("a.forumtitle").each((_i, a) => {
      const $a = $(a);
      const href = $a.attr("href");
      const url = absoluteUrl(base, href);
      const id = idFromUrl(base, href, "f");
      const title = cleanText($a.text());
      if (!url || !id || title === "" || seen.has(id)) return;
      seen.add(id);
      forums.push({ id, title, url, description: null, category: null });
    });
  }

  return forums;
}

// ---------------------------------------------------------------------------
// parseForum — a forum's topic listing (viewforum.php)
// ---------------------------------------------------------------------------

function parseForum(base: string, html: string): TopicSummary[] {
  const $ = loadHtml(html);
  if (!$) return [];
  return collectTopicRows(base, $, $("a.topictitle"));
}

/** Shared logic: turn each `a.topictitle` anchor into a TopicSummary by reading
 *  its enclosing topic row. Used by parseForum (the active-topics / search view
 *  uses the same markup, but parseSearch builds richer SearchResult records). */
function collectTopicRows(
  base: string,
  $: cheerio.CheerioAPI,
  anchors: Cheerio<AnyNode>,
): TopicSummary[] {
  const rows: TopicSummary[] = [];
  const seen = new Set<string>();

  anchors.each((_i, a) => {
    const $a = $(a);
    const href = $a.attr("href");
    const url = absoluteUrl(base, href);
    const id = idFromUrl(base, href, "t");
    const title = cleanText($a.text());
    if (!url || title === "") return;
    const dedupeKey = id ?? url;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const $row = $a.closest("li.row, li");
    const $dl = $a.closest("dl");

    // Topic starter: the poster line in the topic-poster / left-box block.
    let author: string | null = null;
    const $poster = $dl.find(".topic-poster, .responsive-hide.left-box").first();
    const posterName = cleanText($poster.find("a.username, a.username-coloured").first().text());
    if (posterName) author = posterName;

    // Forum the topic belongs to (shown in search / active views): the
    // viewforum link in the poster line.
    let forumTitle: string | null = null;
    const forumLink = $dl
      .find('a[href*="viewforum.php"]')
      .filter((_k, el) => cleanText($(el).text()) !== "")
      .last();
    if (forumLink.length) forumTitle = cleanText(forumLink.text());

    // Replies / views from the dd cells, when present.
    const replies = firstInt($dl.find("dd.posts").first().text());
    const views = firstInt($dl.find("dd.views").first().text());

    // Last-post date text.
    let lastPostAt: string | null = null;
    const lastTime = $dl.find("dd.lastpost time").first();
    if (lastTime.length) lastPostAt = cleanText(lastTime.text());
    else {
      const lp = cleanText($dl.find("dd.lastpost span").first().text());
      if (lp) lastPostAt = lp;
    }

    rows.push({
      id: id ?? "",
      title,
      url,
      author,
      replies,
      views,
      forumTitle,
      lastPostAt,
    });
    void $row; // row reserved for future use; selectors above operate on $dl
  });

  return rows;
}

// ---------------------------------------------------------------------------
// parseTopic — a single topic's posts (viewtopic.php)
// ---------------------------------------------------------------------------

function parseTopic(base: string, html: string): Topic {
  const empty: Topic = {
    id: "",
    title: "",
    url: "",
    posts: [],
    page: 1,
    totalPages: null,
  };
  const $ = loadHtml(html);
  if (!$) return empty;

  // Title + topic id/url from the page heading (h2.topic-title > a).
  const $titleLink = $("h2.topic-title a").first();
  const titleHref = $titleLink.attr("href");
  const title = cleanText($titleLink.text() || $("h2.topic-title").first().text());
  const id = idFromUrl(base, titleHref, "t") ?? "";
  const url =
    absoluteUrl(base, titleHref) ??
    (id ? `${base}viewtopic.php?t=${id}` : "");

  // Pagination: the topic-level .pagination block (the one NOT nested inside a
  // post). Current page = li.active span; totalPages = max numeric page link.
  let page = 1;
  let totalPages: number | null = null;
  const $pag = $(".pagination").filter((_i, el) => $(el).closest(".post").length === 0).first();
  if ($pag.length) {
    const active = firstInt($pag.find("li.active span, li.active a").first().text());
    if (active) page = active;
    let max = 0;
    $pag.find("li a.button, li a, li.active span").each((_i, el) => {
      const n = firstInt($(el).text());
      if (n && n > max) max = n;
    });
    if (max > 0) totalPages = Math.max(max, page);
  }

  // Posts: real posts are `div.post` carrying a numeric id (id="pNNNN") and a
  // .content body. We skip ad blocks (id="post_advs*", .content.adsm_block),
  // skip empty-content duplicates, and dedupe by post id.
  const posts: Post[] = [];
  const seenPostIds = new Set<string>();

  $("div.post").each((_i, el) => {
    const $post = $(el);
    const domId = $post.attr("id") ?? "";
    if (/^post_advs/i.test(domId)) return; // advertisement block

    const $content = $post.find(".content").first();
    if (!$content.length) return;
    if ($content.hasClass("adsm_block")) return; // ad content

    const text = readableText($content.get(0) as AnyNode);
    if (text === "") return; // empty / placeholder duplicate

    // post id: prefer the DOM id (pNNNN), else a permalink href.
    let postId: string | null = /^p(\d+)$/.exec(domId)?.[1] ?? null;

    // Permalink: the h3 title link or the p.author permalink anchor (p=NNNN#pNNNN).
    let permalink: string | null = null;
    const $permA = $post.find('.postbody h3 a, .postbody p.author a[href*="#p"]').first();
    const permHref = $permA.attr("href");
    if (permHref) {
      permalink = absoluteUrl(base, permHref);
      if (!postId) postId = idFromUrl(base, permHref, "p");
    }
    if (!permalink && postId) permalink = `${base}viewtopic.php?p=${postId}#p${postId}`;

    // Author: the profile column username, else the p.author byline username.
    let author: string | null = null;
    const profName = cleanText(
      $post.find(".postprofile a.username, .postprofile a.username-coloured").first().text(),
    );
    if (profName) author = profName;
    else {
      const bylineName = cleanText(
        $post
          .find("p.author a.username, p.author a.username-coloured")
          .first()
          .text(),
      );
      if (bylineName) author = bylineName;
    }

    // Posted-at: the <time> in the p.author byline.
    let postedAt: string | null = null;
    const $time = $post.find("p.author time").first();
    if ($time.length) postedAt = cleanText($time.text());

    const key = postId ?? permalink ?? `idx_${posts.length}`;
    if (seenPostIds.has(key)) return;
    seenPostIds.add(key);

    const attachments = collectAttachments(base, $, $post);

    posts.push({ id: postId, author, postedAt, text, url: permalink, attachments });
  });

  // When pagination markup is absent but the topic has real posts, default to
  // the current page so callers always get a positive page count for a topic.
  if (totalPages === null && posts.length > 0) {
    totalPages = Math.max(page, 1);
  }

  return { id, title, url, posts, page, totalPages };
}

// ---------------------------------------------------------------------------
// parseSearch — search results / active-topics view (search.php)
// ---------------------------------------------------------------------------

function parseSearch(base: string, html: string): SearchResult[] {
  const $ = loadHtml(html);
  if (!$) return [];
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  $("a.topictitle").each((_i, a) => {
    const $a = $(a);
    const href = $a.attr("href");
    const url = absoluteUrl(base, href);
    const title = cleanText($a.text());
    if (!url || title === "") return;
    const topicId = idFromUrl(base, href, "t");
    const dedupeKey = topicId ?? url;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const $dl = $a.closest("dl");

    // Author of the topic/matched post: the poster username.
    let author: string | null = null;
    const posterName = cleanText(
      $dl.find(".responsive-hide.left-box, .topic-poster").first()
        .find("a.username, a.username-coloured").first().text(),
    );
    if (posterName) author = posterName;

    // Forum: the viewforum link for the result row.
    let forumTitle: string | null = null;
    const forumLink = $dl
      .find('a[href*="viewforum.php"]')
      .filter((_k, el) => cleanText($(el).text()) !== "")
      .last();
    if (forumLink.length) forumTitle = cleanText(forumLink.text());

    // Snippet: true phpBB search results include a `.postbody` preview inside the
    // row. Active-topics rows have none, so this is best-effort/null. Quoted text
    // ([quote]…[/quote] -> <blockquote>) is removed first so the snippet reflects
    // the user's own words, not what they were quoting. We work on a clone to
    // avoid mutating shared nodes.
    let snippet: string | null = null;
    const $snippet = $dl.find(".postbody .content, .postbody p, .search_block .content").first();
    if ($snippet.length) {
      const $c = $snippet.clone();
      $c.find("blockquote, .quotetitle, .quotecontent").remove();
      const s = cleanText($c.text());
      if (s) snippet = s;
    }

    // Date: the topic-poster <time>, else the last-post time.
    let postedAt: string | null = null;
    const posterTime = $dl.find(".responsive-hide.left-box time, .topic-poster time").first();
    if (posterTime.length) postedAt = cleanText(posterTime.text());
    else {
      const lastTime = $dl.find("dd.lastpost time").first();
      if (lastTime.length) postedAt = cleanText(lastTime.text());
    }

    // Reply / view counts (topic-search + active-topics rows carry these) — used to
    // rank a user's topics by views.
    const replies = firstInt($dl.find("dd.posts").first().text());
    const views = firstInt($dl.find("dd.views").first().text());

    results.push({ topicId, title, url, forumTitle, author, snippet, postedAt, replies, views });
  });

  return results;
}

// ---------------------------------------------------------------------------
// parsePostSearch — "all posts by a user" search results (search.php?sr=posts).
// Posts are `div.search.post` blocks; the total count is in the
// `h2.searchresults-title` heading ("found N results").
// ---------------------------------------------------------------------------

function parsePostSearch(base: string, html: string): AuthorPostsResult {
  const $ = loadHtml(html);
  if (!$) return { total: null, posts: [] };

  // Total = the integer in the "found N results" heading.
  const heading = cleanText(
    $("h2.searchresults-title, .searchresults-title").first().text(),
  );
  const total = firstInt(heading);

  const posts: SearchResult[] = [];
  const seen = new Set<string>();

  $("div.search.post").each((_i, el) => {
    const $post = $(el);

    // Title + permalink: the post-title anchor (viewtopic.php?p=NNNN#pNNNN).
    const $titleA = $post
      .find(".postbody h3 a, h3.posttitle a, a.posttitle, .postbody h3 a.postlink")
      .first();
    const href = $titleA.attr("href");
    const url = absoluteUrl(base, href);
    const title = cleanText($titleA.text());
    if (!url || title === "") return;

    const postId = idFromUrl(base, href, "p");
    // Topic id from the topic link in the row; fall back to the title href.
    const $topicLink = $post.find('a[href*="viewtopic.php?t="]').first();
    const topicId = idFromUrl(base, $topicLink.attr("href"), "t") ?? idFromUrl(base, href, "t");
    const dedupeKey = postId ?? url;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    // Forum the post is in: a viewforum link in the result row, if shown.
    let forumTitle: string | null = null;
    const forumLink = $post
      .find('a[href*="viewforum.php"]')
      .filter((_k, a) => cleanText($(a).text()) !== "")
      .last();
    if (forumLink.length) forumTitle = cleanText(forumLink.text());

    // Author byline (should match the searched user).
    let author: string | null = null;
    const name = cleanText(
      $post
        .find(
          "dt.author a.username, dt.author a.username-coloured, " +
            "p.author a.username, .author a.username",
        )
        .first()
        .text(),
    );
    if (name) author = name;

    // Snippet: the matched post body preview. Quoted text ([quote]…[/quote] ->
    // <blockquote>) is removed first so the snippet reflects the user's own words,
    // not what they were quoting. We work on a clone to avoid mutating shared nodes.
    let snippet: string | null = null;
    const $content = $post.find(".content").first();
    if ($content.length) {
      const $c = $content.clone();
      $c.find("blockquote, .quotetitle, .quotecontent").remove();
      const s = readableText($c.get(0) as AnyNode);
      if (s) snippet = s;
    }

    // Posted-at: prosilver search results put the date in dd.search-result-date;
    // fall back to a <time> element.
    let postedAt: string | null = null;
    const dateText = cleanText($post.find("dd.search-result-date").first().text());
    if (dateText) postedAt = dateText;
    else {
      const $time = $post.find("time").first();
      if ($time.length) postedAt = cleanText($time.text());
    }

    // Reply / view counts of the topic this post is in (shown as replies / views
    // dd cells in each result block).
    let replies: number | null = null;
    let views: number | null = null;
    $post.find("dd").each((_k, dd) => {
      const t = cleanText($(dd).text());
      if (replies === null && /תגובות|replies/i.test(t)) replies = firstInt(t);
      if (views === null && /געזען|views/i.test(t)) views = firstInt(t);
    });

    posts.push({ topicId, title, url, forumTitle, author, snippet, postedAt, replies, views });
  });

  return { total, posts };
}

// ---------------------------------------------------------------------------
// parseNotifications — UCP notifications (login required)
// ---------------------------------------------------------------------------

// NOTE: built against standard phpBB markup; unverified against a live logged-in
// session because login is often blocked (see README). Adjust selectors if needed.
function parseNotifications(base: string, html: string): Notification[] {
  const $ = loadHtml(html);
  if (!$) return [];
  const notifications: Notification[] = [];
  const seen = new Set<string>();

  // phpBB standard: the notifications dropdown/list is `.notification_list`,
  // with each entry as an `li` (often `a.notification-block`) containing the
  // notification text, a time, and an unread marker. We are lenient about the
  // inner markup.
  const items = $(
    ".notification_list li, .notification_list a.notification-block, " +
      "ul.notification-list li, .notifications li",
  );

  items.each((_i, el) => {
    const $el = $(el);

    // The link the notification points to.
    const $a = $el.is("a") ? $el : $el.find("a").first();
    const href = $a.attr("href");
    const url = absoluteUrl(base, href);

    // Text: prefer an explicit `.notification_title` / `.notification-title`,
    // else the anchor/item text (minus the time).
    let text = cleanText(
      $el.find(".notification_title, .notification-title, .notifications_title").first().text(),
    );
    if (text === "") {
      const $clone = $a.length ? $a.clone() : $el.clone();
      $clone.find("time, .notification-time, .notification_time").remove();
      text = cleanText($clone.text());
    }
    if (text === "") return;

    // Time: a <time> element or a `.notification-time` span.
    let time: string | null = null;
    const $time = $el.find("time, .notification-time, .notification_time").first();
    if ($time.length) time = cleanText($time.text());

    // Unread: phpBB marks unread rows with a class on the li / anchor.
    let unread: boolean | null = null;
    const cls = ($el.attr("class") ?? "") + " " + ($a.attr("class") ?? "");
    if (/\bunread\b/i.test(cls)) unread = true;
    else if (/\bread\b/i.test(cls)) unread = false;

    const key = (url ?? "") + "|" + text;
    if (seen.has(key)) return;
    seen.add(key);

    notifications.push({ text, url, time, unread });
  });

  return notifications;
}

// ---------------------------------------------------------------------------
// parsePrivateMessages — UCP PM inbox (login required)
// ---------------------------------------------------------------------------

// NOTE: built against standard phpBB markup; unverified against a live logged-in
// session because login is often blocked (see README). Adjust selectors if needed.
function parsePrivateMessages(base: string, html: string): PrivateMessage[] {
  const $ = loadHtml(html);
  if (!$) return [];
  const messages: PrivateMessage[] = [];
  const seen = new Set<string>();

  // phpBB standard UCP PM inbox: messages are rows in the message list. In
  // prosilver the subject link carries class `topictitle` inside
  // `ul.cplist`/`li.row` items (a structure mirroring the topic list). We accept
  // either a `topictitle`-style subject anchor or a generic `pm-legend`/row
  // subject link, and read sender + time from the row's author/time bits.
  const rows = $("ul.cplist li.row, .cplist li.row, li.row.pm, table.table1 tbody tr");

  rows.each((_i, el) => {
    const $row = $(el);

    // Subject + read link: prefer a topictitle-style anchor, else the first
    // anchor whose href points at a PM view.
    let $subject = $row.find("a.topictitle").first();
    if (!$subject.length) {
      $subject = $row
        .find('a[href*="mode=view"], a[href*="p="], a.pm-subject')
        .filter((_k, a) => cleanText($(a).text()) !== "")
        .first();
    }
    const subject = cleanText($subject.text());
    if (subject === "") return;
    const url = absoluteUrl(base, $subject.attr("href"));

    // Sender: the author/username in the row.
    let from: string | null = null;
    const sender = cleanText(
      $row.find(".responsive-hide a.username, a.username, a.username-coloured, .pm-from").first().text(),
    );
    if (sender) from = sender;

    // Sent date/time.
    let sentAt: string | null = null;
    const $time = $row.find("time").first();
    if ($time.length) sentAt = cleanText($time.text());

    // Unread: prosilver flags unread PMs with a `pm_unread` / `unread` class on
    // the row or its dl.
    let unread: boolean | null = null;
    const cls = ($row.attr("class") ?? "") + " " + ($row.find("dl").attr("class") ?? "");
    if (/\b(pm_unread|unread)\b/i.test(cls)) unread = true;
    else if (/\b(pm_read|read)\b/i.test(cls)) unread = false;

    const key = (url ?? "") + "|" + subject;
    if (seen.has(key)) return;
    seen.add(key);

    messages.push({ subject, from, sentAt, url, unread });
  });

  return messages;
}

// ---------------------------------------------------------------------------
// detectNotice — explain why a search returned nothing
//
// When a search yields no usable rows, phpBB serves a message/notice page rather
// than a results list (terms too common, search flood control, login required,
// or simply no matches). This classifies that page so callers can report the
// reason instead of returning a silent empty array. Returns null when the input
// is a normal results page (or is empty/unparseable). Never throws.
// ---------------------------------------------------------------------------

// Classification patterns. Boards may render notices in English or another
// language pack (the Yiddish/Hebrew wording below is one such pack), so each
// kind matches multiple phrasings. Order matters: the first kind that matches
// wins. To support another language pack, add its wording to the relevant regex.
const NOTICE_PATTERNS: ReadonlyArray<{ kind: SearchNotice["kind"]; re: RegExp }> = [
  {
    kind: "words_ignored",
    re: /common word|too common|ignored because|שכיח|כאטש .{0,3}\d|מוז.{0,8}\d.{0,8}אותיות|at least \d|too short|fewer than|less than \d char/i,
  },
  {
    kind: "flood_wait",
    re: /flood|too soon|only search.*once|wait.*\d.*second|try again in \d+\s*second|מען קען נישט יעצט זוכן|פראבירט נאכאמאל אין \d|נאכאמאל אין \d+\s*סעקונד|\d+\s*סעקונדע?ס|זוכן נאכאמאל|מוזט?\s*ווארטן|נאך אמאל/i,
  },
  {
    kind: "login_required",
    re: /must be (logged|registered)|log ?in to|not authoris|permission|אריינגעלאגט|הירשם|רשות|איינלאגירן/i,
  },
  {
    kind: "no_results",
    re: /no suitable matches|did not match|no results|returned no|לא נמצא|נישט געפונען|קיין רעזולטאט|0 רעזולטאט/i,
  },
];

function detectNotice(html: string): SearchNotice | null {
  const $ = loadHtml(html);
  if (!$) return null;

  // A normal results page is not a notice. Treat it as normal if it carries any
  // of the usual result markers, or a "found N results" heading with N > 0.
  if ($("div.search.post").length > 0 || $("a.topictitle").length > 0) {
    return null;
  }
  const $resultsTitle = $("h2.searchresults-title").first();
  if ($resultsTitle.length) {
    const found = firstInt($resultsTitle.text());
    if (found !== null && found > 0) return null;
  }

  // Locate the notice/message text. phpBB places it in `.message-text`, in the
  // element/paragraph following the message title, or inside a `.panel .inner`.
  let message = cleanText($(".message-text").first().text());

  if (!message) {
    const $title = $("h2.message-title, h2.searchresults-title").first();
    if ($title.length) {
      const $next = $title.next();
      if ($next.length) message = cleanText($next.text());
      if (!message) {
        // Fall back to the surrounding panel/container text, minus the heading.
        const $panel = $title.closest(".panel, #message, .message");
        if ($panel.length) {
          const $clone = $panel.clone();
          $clone.find("h2").remove();
          message = cleanText($clone.text());
        }
      }
    }
  }

  if (!message) {
    message = cleanText($(".panel .inner").first().text());
  }

  // Classify by the message text. With no text to match, it is still a non-result
  // page, so report a generic notice.
  if (!message) return { kind: "notice", message: null };

  for (const { kind, re } of NOTICE_PATTERNS) {
    if (re.test(message)) return { kind, message };
  }
  return { kind: "notice", message };
}

// ---------------------------------------------------------------------------
// parseAuthorPostCount — a user's authoritative lifetime post count from a topic.
//
// phpBB exposes TWO different "total posts" numbers: the search-results count
// (filtered to what the viewer can read) and `user_posts` (the authoritative
// lifetime count). The latter is shown on the member profile (login-gated here)
// AND, publicly, in the `.profile-posts` line of every post's profile block on a
// topic page. We read it from there.
// ---------------------------------------------------------------------------

function parseAuthorPostCount(html: string, author: string): number | null {
  const $ = loadHtml(html);
  if (!$) return null;
  const target = (author ?? "").trim();
  if (target === "") return null;

  let count: number | null = null;
  $("div.post").each((_i, el) => {
    if (count !== null) return;
    const $post = $(el);
    const name = cleanText(
      $post
        .find(".postprofile a.username, .postprofile a.username-coloured")
        .first()
        .text(),
    );
    if (name !== target) return;
    const n = firstInt($post.find(".postprofile .profile-posts").first().text());
    if (n !== null) count = n;
  });
  return count;
}

/**
 * Build a set of parsers bound to a specific forum base URL. All base-dependent
 * link resolution closes over this instance's `base`, so several parser
 * instances can coexist in one process without sharing mutable state.
 */
export function createParsers(baseUrl: string): Parsers {
  const base = normalizeBaseUrl(baseUrl);
  return {
    parseForumIndex: (html) => parseForumIndex(base, html),
    parseForum: (html) => parseForum(base, html),
    parseTopic: (html) => parseTopic(base, html),
    parseSearch: (html) => parseSearch(base, html),
    parsePostSearch: (html) => parsePostSearch(base, html),
    parseAuthorPostCount,
    detectNotice,
    parseNotifications: (html) => parseNotifications(base, html),
    parsePrivateMessages: (html) => parsePrivateMessages(base, html),
  };
}
