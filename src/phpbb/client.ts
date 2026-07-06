// HTTP client + login/session for the ivelt.com phpBB forum.
//
// Implements the IveltClient interface (see ../contract.ts): an authenticated,
// politely rate-limited fetcher that returns RAW HTML strings. It owns login +
// phpBB session cookies, a desktop browser User-Agent, and the phpBB URL shapes.
// It does NOT parse HTML — that is the parsers' job (parse.ts).
//
// Design notes:
//  - Node global `fetch` is used. EVERY request carries a desktop User-Agent
//    header; a blank/missing UA gets a 403 from Cloudflare (verified).
//  - Session cookies are tracked with tough-cookie's CookieJar. We read every
//    response's Set-Cookie headers into the jar and replay the jar's Cookie
//    header on each request. Redirects are followed MANUALLY so cookies set on
//    intermediate hops (e.g. the phpBB search 302 -> search_id=... redirect, or
//    login redirects) are captured and carried forward.
//  - Lazy login: every get* method ensures a session first. login() is idempotent.
//  - Requests are serialized with a ~1s delay between outgoing requests (polite).

import { CookieJar } from "tough-cookie";
import type { PhpbbConfig } from "../config.js";
import type { PhpbbClient } from "../contract.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Minimum gap between outgoing requests, in milliseconds (be polite). */
const MIN_REQUEST_GAP_MS = 900;

/** Cap on redirect hops we will follow for a single logical request. */
const MAX_REDIRECTS = 10;

/** Posts/topics per page on ivelt (verified: topics and forum listings both
 *  paginate at 25 per page, so `start` offsets must step by 25). */
const FORUM_PER_PAGE = 25;
const TOPIC_PER_PAGE = 25;
// ivelt's search results list 25 hits per page (verified against captured pages).
const SEARCH_PER_PAGE = 25;

// ivelt rate-limits searches (phpBB flood control: ~15s between searches). We
// (a) cache recent search results so repeated/overlapping queries don't re-hit
// the network, and (b) when a search IS throttled, read the "try again in N
// seconds" notice and wait it out, then retry — so callers don't see a failure.
const SEARCH_CACHE_TTL_MS = 180_000; // 3 min — forum data changes slowly
const SEARCH_CACHE_MAX_ENTRIES = 200; // bound memory in a long-running process
const SEARCH_FLOOD_MAX_RETRIES = 2;
const SEARCH_FLOOD_FALLBACK_MS = 15_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

class PhpbbClientImpl implements PhpbbClient {
  private readonly config: PhpbbConfig;
  private readonly jar: CookieJar;

  /** True once a successful login has established a session. */
  private loggedIn = false;
  /** Serializes login so concurrent get* calls don't double-login. */
  private loginPromise: Promise<void> | null = null;
  /** Serializes all outgoing requests (and enforces the polite delay). */
  private requestChain: Promise<unknown> = Promise.resolve();
  /** Timestamp (ms) of the last outgoing request, for rate limiting. */
  private lastRequestTime = 0;
  /** Short-lived cache of search-result HTML, keyed by URL (see SEARCH_CACHE_TTL_MS). */
  private readonly searchCache = new Map<string, { html: string; expires: number }>();

  constructor(config: PhpbbConfig) {
    this.config = config;
    this.jar = new CookieJar();
  }

  // ---- public API (IveltClient) -------------------------------------------

  async login(): Promise<void> {
    // Idempotent: no-op if a session is already established.
    if (this.loggedIn) return;
    // Collapse concurrent callers onto a single in-flight login.
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = this.doLogin().finally(() => {
      this.loginPromise = null;
    });
    return this.loginPromise;
  }

  async getForumIndex(): Promise<string> {
    // Public — no login needed (and ivelt's Cloudflare blocks the login page).
    return this.fetchHtml(`${this.config.baseUrl}/index.php`);
  }

  async getForum(
    forumId: string,
    page = 1,
    sort: "recent" | "views" | "replies" = "recent",
  ): Promise<string> {
    const start = this.startFor(page, FORUM_PER_PAGE);
    // phpBB topic sort keys: v = views, r = replies; default order is by last post.
    const sortParam =
      sort === "views" ? "&sk=v&sd=d" : sort === "replies" ? "&sk=r&sd=d" : "";
    return this.fetchHtml(
      `${this.config.baseUrl}/viewforum.php?f=${encodeURIComponent(
        forumId,
      )}&start=${start}${sortParam}`,
    );
  }

  async getTopic(topicId: string, page = 1): Promise<string> {
    const start = this.startFor(page, TOPIC_PER_PAGE);
    return this.fetchHtml(
      `${this.config.baseUrl}/viewtopic.php?t=${encodeURIComponent(
        topicId,
      )}&start=${start}`,
    );
  }

  async search(keywords: string, page = 1): Promise<string> {
    const start = this.startFor(page, SEARCH_PER_PAGE);
    // phpBB GET search may 302 to search.php?search_id=...; redirects are
    // followed (with cookies) by fetchHtml, returning the final HTML.
    return this.fetchSearchHtml(
      `${this.config.baseUrl}/search.php?keywords=${encodeURIComponent(
        keywords,
      )}&sf=msgonly&start=${start}`,
    );
  }

  async searchAuthorTopics(author: string, page = 1): Promise<string> {
    // Topics STARTED by a user: phpBB author search restricted to first posts.
    // Public — unlike keyword search, this is unaffected by the min-word-length
    // / common-word rules, so it reliably finds a user's own topics.
    // sk=t&sd=d pins the sort order (post time, newest first) so paging is
    // stable; without it the forum re-sorts, producing overlapping pages.
    const start = this.startFor(page, SEARCH_PER_PAGE);
    return this.fetchSearchHtml(
      `${this.config.baseUrl}/search.php?author=${encodeURIComponent(
        author,
      )}&sr=topics&sf=firstpost&sk=t&sd=d&start=${start}`,
    );
  }

  async searchAuthorPosts(author: string, page = 1, keywords?: string): Promise<string> {
    // ALL posts (replies + topic starts) by a user, via phpBB author search.
    // Public; the results heading reports the user's total post count.
    // sk=t&sd=d pins the sort order (post time, newest first) so paging is
    // stable; without it the forum re-sorts, producing overlapping pages.
    const start = this.startFor(page, SEARCH_PER_PAGE);
    let url = `${this.config.baseUrl}/search.php?author=${encodeURIComponent(
      author,
    )}&sr=posts&sk=t&sd=d&start=${start}`;
    // Optionally narrow to the author's posts containing the given keywords.
    if (keywords && keywords.length > 0) {
      url += `&keywords=${encodeURIComponent(keywords)}`;
    }
    return this.fetchSearchHtml(url);
  }

  async getNotifications(): Promise<string> {
    await this.ensureSession();
    return this.fetchHtml(`${this.config.baseUrl}/ucp.php?i=ucp_notifications`);
  }

  async getPrivateMessages(): Promise<string> {
    await this.ensureSession();
    return this.fetchHtml(`${this.config.baseUrl}/ucp.php?i=pm&folder=inbox`);
  }

  async getPostPage(url: string): Promise<string> {
    // Only fetch pages on the configured ivelt host (the URL comes from our own
    // parsed results; this guards against being handed an off-site URL).
    let origin: string;
    try {
      origin = new URL(this.config.baseUrl).origin;
    } catch {
      origin = "https://www.ivelt.com";
    }
    if (!url.startsWith(origin)) {
      throw new Error(`Refusing to fetch a non-ivelt URL: ${url}`);
    }
    return this.fetchHtml(url);
  }

  /**
   * Lightweight diagnostic probe. Fetches the board index and inspects the HTML:
   *  - `reachable` is true when the request succeeds and the body looks like the
   *    forum (a `forumtitle` link, or the phpBB body markup).
   *  - `loggedIn` is true when the page exposes a logout link (mode=logout),
   *    which phpBB only renders for an authenticated session.
   * Reuses fetchHtml so cookies, User-Agent, and the polite throttle apply.
   * Never throws — any failure reports the forum as unreachable.
   */
  async checkConnectivity(): Promise<{ reachable: boolean; loggedIn: boolean }> {
    try {
      const html = await this.fetchHtml(`${this.config.baseUrl}/index.php`);
      const reachable =
        /class\s*=\s*["'][^"']*\bforumtitle\b/i.test(html) ||
        /<body[^>]*\bid\s*=\s*["']phpbb["']/i.test(html);
      const loggedIn = /mode=logout/i.test(html);
      return { reachable, loggedIn };
    } catch {
      return { reachable: false, loggedIn: false };
    }
  }

  // ---- session handling ----------------------------------------------------

  /** Ensure a logged-in session exists before a page fetch (lazy login). */
  private async ensureSession(): Promise<void> {
    if (!this.loggedIn) {
      await this.login();
    }
  }

  /** Compute the phpBB `start` offset for a 1-based page. */
  private startFor(page: number | undefined, perPage: number): number {
    const p = Number.isFinite(page) && (page as number) > 0 ? (page as number) : 1;
    return (p - 1) * perPage;
  }

  /**
   * Perform the actual login: GET the login form to harvest phpBB's hidden CSRF
   * fields (sid / creation_time / form_token), then POST credentials. phpBB
   * returns a 3xx redirect on success; fetchHtml follows it (carrying cookies),
   * so the session cookie ends up in the jar either way.
   */
  private async doLogin(): Promise<void> {
    const loginUrl = `${this.config.baseUrl}/ucp.php?mode=login`;

    // 1) GET the login page so the session-id cookie is established and the
    //    hidden CSRF fields are available to echo back.
    //    NOTE: ivelt fronts the forum with Cloudflare, which blocks the login
    //    page (HTTP 403) for non-browser/headless requests. So login is not
    //    actually reachable from this server. Browsing/reading/search are all
    //    public and work without login; only notifications + private messages
    //    need it. Surface a clear, accurate error rather than a raw 403.
    let formHtml: string;
    try {
      formHtml = await this.fetchHtml(loginUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        "ivelt login is unavailable: the login page is blocked by the site's " +
          "Cloudflare protection for automated requests, so notifications and " +
          "private messages can't be read by this server. Browsing forums, " +
          "reading topics, and searching all work without login. " +
          `(underlying: ${msg})`,
      );
    }
    const hidden = extractLoginHiddenFields(formHtml);

    // 2) Build the urlencoded login body. Always include the required fields;
    //    add any harvested hidden fields (creation_time/form_token/sid/redirect).
    const body = new URLSearchParams();
    body.set("username", this.config.username);
    body.set("password", this.config.password);
    body.set("login", "login");
    for (const [name, value] of Object.entries(hidden)) {
      // Don't clobber the explicit credential fields with stale hidden ones.
      if (name === "username" || name === "password" || name === "login") continue;
      body.set(name, value);
    }

    // 3) POST the credentials. Mark loggedIn BEFORE issuing the request so the
    //    POST itself does not recursively try to ensure a session.
    this.loggedIn = true;
    try {
      await this.fetchHtml(loginUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });
    } catch (err) {
      // Login failed — reset so a later call can retry from scratch.
      this.loggedIn = false;
      throw err;
    }
  }

  // ---- low-level fetch with cookies + manual redirects ---------------------

  /**
   * Fetch a URL and return its body text. Requests are serialized through a
   * single chain so the polite inter-request delay is honored even under
   * concurrent callers. Cookies are read from / replayed into the jar, and
   * redirects are followed manually so cookies set mid-chain are captured.
   * Throws a clear Error on a non-OK final HTTP status.
   */
  private fetchHtml(url: string, init: RequestInit = {}): Promise<string> {
    const run = this.requestChain.then(() => this.doFetchHtml(url, init));
    // Keep the chain alive regardless of this request's success/failure.
    this.requestChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Fetch a SEARCH page with two cushions against ivelt's search rate limit:
   *  1. a short-lived cache, so repeated/overlapping searches (e.g. profile_user
   *     run twice, or posts_by_author reusing a page) don't re-hit the network;
   *  2. flood handling — if the forum returns "try again in N seconds", wait that
   *     long (read from the notice) and retry, so the caller gets results instead
   *     of an empty/throttled page. Flood pages are never cached.
   */
  private async fetchSearchHtml(url: string): Promise<string> {
    const cached = this.searchCache.get(url);
    if (cached && cached.expires > Date.now()) return cached.html;

    let html = await this.fetchHtml(url);
    for (let attempt = 0; attempt < SEARCH_FLOOD_MAX_RETRIES && looksFlooded(html); attempt++) {
      await sleep(floodWaitMs(html));
      html = await this.fetchHtml(url);
    }

    if (!looksFlooded(html)) {
      this.pruneSearchCache();
      this.searchCache.set(url, { html, expires: Date.now() + SEARCH_CACHE_TTL_MS });
    }
    return html;
  }

  /** Keep the search cache bounded: drop expired entries once it grows large,
   *  and if it's still at the cap, clear it (cheap — entries just get re-fetched). */
  private pruneSearchCache(): void {
    if (this.searchCache.size < SEARCH_CACHE_MAX_ENTRIES) return;
    const now = Date.now();
    for (const [key, entry] of this.searchCache) {
      if (entry.expires <= now) this.searchCache.delete(key);
    }
    if (this.searchCache.size >= SEARCH_CACHE_MAX_ENTRIES) this.searchCache.clear();
  }

  private async doFetchHtml(url: string, init: RequestInit): Promise<string> {
    await this.throttle();

    let currentUrl = url;
    let currentInit: RequestInit = init;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const cookieHeader = await this.jar.getCookieString(currentUrl);
      const headers = new Headers(currentInit.headers);
      headers.set("User-Agent", USER_AGENT);
      headers.set(
        "Accept",
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      );
      headers.set("Accept-Language", "en-US,en;q=0.9");
      if (cookieHeader) headers.set("Cookie", cookieHeader);

      let response: Response;
      try {
        response = await fetch(currentUrl, {
          ...currentInit,
          headers,
          redirect: "manual",
        });
      } catch (err) {
        throw classifyFetchError(err, currentUrl);
      }

      // Capture every Set-Cookie from this hop into the jar.
      await this.storeCookies(response, currentUrl);

      // Follow 3xx redirects manually (carrying cookies forward).
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          // Redirect with no target — return whatever body we have.
          return response.text();
        }
        currentUrl = new URL(location, currentUrl).toString();
        // Per the fetch spec, 301/302/303 turn the method into GET and drop the
        // body; 307/308 preserve method + body. phpBB uses 302 after login.
        if (response.status !== 307 && response.status !== 308) {
          currentInit = {};
        }
        continue;
      }

      if (!response.ok) {
        let message = `HTTP ${response.status} ${response.statusText} for ${currentUrl}`;
        if (response.status === 403) {
          message +=
            " — this may be Cloudflare blocking automated access to the site.";
        }
        throw new Error(message);
      }

      return response.text();
    }

    throw new Error(`Too many redirects (>${MAX_REDIRECTS}) starting at ${url}`);
  }

  /** Read all Set-Cookie headers from a response into the cookie jar. */
  private async storeCookies(response: Response, url: string): Promise<void> {
    // Node's fetch exposes all Set-Cookie values via getSetCookie(); fall back
    // to the single header for older runtimes.
    let setCookies: string[] = [];
    const anyHeaders = response.headers as Headers & {
      getSetCookie?: () => string[];
    };
    if (typeof anyHeaders.getSetCookie === "function") {
      setCookies = anyHeaders.getSetCookie();
    } else {
      const single = response.headers.get("set-cookie");
      if (single) setCookies = [single];
    }
    for (const sc of setCookies) {
      try {
        await this.jar.setCookie(sc, url);
      } catch {
        // Ignore malformed cookies — they shouldn't break the whole request.
      }
    }
  }

  /** Enforce the minimum gap between outgoing requests. */
  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (this.lastRequestTime !== 0 && elapsed < MIN_REQUEST_GAP_MS) {
      await sleep(MIN_REQUEST_GAP_MS - elapsed);
    }
    this.lastRequestTime = Date.now();
  }
}

/**
 * Turn a low-level fetch failure into a clear, actionable Error.
 *
 * Node's fetch wraps the real cause in a TypeError ("fetch failed"); the useful
 * detail (a TLS or system error code) lives on the underlying `cause`. We
 * inspect both the message and the cause's code/message and classify into:
 *  - TLS/certificate problems (commonly TLS interception) → point at the
 *    documented `node --use-system-ca` workaround.
 *  - DNS/connection problems → a plain network-error message.
 *  - anything else → a generic message that still names the URL and cause.
 */
/**
 * Does this page look like ivelt's search flood-control notice?
 * (e.g. "ביטע אנטשולדיגן, אבער מען קען נישט יעצט זוכן, ביטע פראבירט נאכאמאל אין 15 סעקונדעס")
 */
function looksFlooded(html: string): boolean {
  return /מען קען נישט יעצט זוכן|פראבירט נאכאמאל אין \d|נאכאמאל אין \d+\s*סעקונד|try again in \d+\s*second|cannot .{0,20}search .{0,20}(now|so soon)/i.test(
    html,
  );
}

/** How long to wait before retrying a flooded search: the "N seconds" stated in
 *  the notice (clamped to 5–30s, plus a 1s buffer), else a safe fallback. */
function floodWaitMs(html: string): number {
  const m = html.match(/(\d+)\s*(?:סעקונדע?ס|seconds?)/i);
  const secs = m ? parseInt(m[1], 10) : NaN;
  if (!Number.isFinite(secs)) return SEARCH_FLOOD_FALLBACK_MS;
  return Math.min(Math.max(secs, 5), 30) * 1000 + 1000;
}

function classifyFetchError(err: unknown, url: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  // Dig the underlying cause out of Node's "fetch failed" wrapper, if present.
  const cause = (err as { cause?: unknown })?.cause;
  const causeMessage =
    cause instanceof Error ? cause.message : cause ? String(cause) : "";
  const causeCode =
    cause && typeof cause === "object" && "code" in cause
      ? String((cause as { code?: unknown }).code ?? "")
      : "";
  // Combined haystack so we catch the signal wherever Node put it.
  const haystack = `${message} ${causeMessage} ${causeCode}`;
  // Prefer the most specific underlying detail when building the message.
  const detail = causeMessage || causeCode || message;

  const tlsSignals = [
    "UNABLE_TO_GET_ISSUER_CERT",
    "SELF_SIGNED",
    "CERT_",
    "unable to verify",
    "DEPTH_ZERO",
  ];
  if (tlsSignals.some((sig) => haystack.includes(sig))) {
    return new Error(
      'TLS certificate error reaching ivelt.com — run the server with ' +
        '"node --use-system-ca" (see README). ' +
        `(underlying: ${detail})`,
    );
  }

  const networkSignals = [
    "ENOTFOUND",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ECONNRESET",
    "EAI_AGAIN",
    "fetch failed",
  ];
  if (networkSignals.some((sig) => haystack.includes(sig))) {
    return new Error(`Could not reach ivelt.com (network error): ${detail}`);
  }

  return new Error(`Request to ${url} failed: ${detail}`);
}

/**
 * Scrape hidden <input> fields from the phpBB login form. phpBB protects the
 * login POST with hidden CSRF fields (creation_time, form_token) plus sid; we
 * echo whatever is present back in the POST body. Returns name -> value pairs.
 * Best-effort and regex-based (we avoid pulling in an HTML parser here).
 */
function extractLoginHiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!html) return fields;

  // Match each <input ... type="hidden" ...> tag (attributes in any order).
  const inputTagRe = /<input\b[^>]*>/gi;
  const tags = html.match(inputTagRe);
  if (!tags) return fields;

  for (const tag of tags) {
    if (!/type\s*=\s*["']?hidden["']?/i.test(tag)) continue;
    const name = attr(tag, "name");
    if (!name) continue;
    const value = attr(tag, "value") ?? "";
    fields[name] = value;
  }
  return fields;
}

/** Extract a single HTML attribute value from a tag string (quoted or bare). */
function attr(tag: string, name: string): string | null {
  const re = new RegExp(
    `\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    "i",
  );
  const m = tag.match(re);
  if (!m) return null;
  const raw = m[2] ?? m[3] ?? m[4] ?? "";
  return decodeHtmlEntities(raw);
}

/** Minimal HTML entity decode for attribute values (form tokens are safe). */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Create an authenticated, rate-limited ivelt phpBB HTTP client.
 * Returns an object satisfying the IveltClient contract.
 */
export function createPhpbbClient(config: PhpbbConfig): PhpbbClient {
  return new PhpbbClientImpl(config);
}

// Backward-compatibility export for existing consumers.
export const createIveltClient = createPhpbbClient;
