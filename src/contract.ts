// The two interfaces that decouple the HTTP layer from the parsing layer:
//
//   PhpbbClient — fetches raw HTML from phpBB pages (client.ts)
//   Parsers     — turn that HTML into typed records (parse.ts)
//
// The MCP tools depend only on these interfaces; index.ts wires the concretes.

import type {
  Forum,
  TopicSummary,
  Topic,
  SearchResult,
  AuthorPostsResult,
  SearchNotice,
  Notification,
  PrivateMessage,
} from "./types.js";

/**
 * Authenticated, rate-limited fetcher for phpBB pages.
 * Each method returns the RAW HTML of the relevant page (a string).
 * The client owns: login + session cookies, a browser User-Agent, polite
 * rate limiting, and knowledge of phpBB URL shapes. It does NOT parse HTML.
 *
 * Lazy login: methods must ensure a valid session first (logging in on demand),
 * so callers can invoke any method without calling login() themselves.
 */
export interface PhpbbClient {
  /** Log in using the configured credentials and establish a session. Idempotent. */
  login(): Promise<void>;
  /** Board index page (list of forums). */
  getForumIndex(): Promise<string>;
  /** A single forum's topic listing. page is 1-based. `sort` orders the topics:
   *  "recent" (default, by last activity), "views" (most-viewed first), or
   *  "replies" (most-replied first). */
  getForum(forumId: string, page?: number, sort?: "recent" | "views" | "replies"): Promise<string>;
  /** A single topic's posts. page is 1-based. */
  getTopic(topicId: string, page?: number): Promise<string>;
  /** Keyword search results page. page is 1-based. */
  search(keywords: string, page?: number): Promise<string>;
  /** Search results listing topics STARTED by a given author (username). page is 1-based. */
  searchAuthorTopics(author: string, page?: number): Promise<string>;
  /** Search results listing ALL posts by a given author (username), optionally
   *  filtered to posts containing `keywords`. Results are sorted newest-first.
   *  page is 1-based. */
  searchAuthorPosts(author: string, page?: number, keywords?: string): Promise<string>;
  /** The logged-in user's notifications page (UCP). */
  getNotifications(): Promise<string>;
  /** The logged-in user's private-message inbox page (UCP). */
  getPrivateMessages(): Promise<string>;
  /** Fetch a single post/topic page by its absolute forum URL (e.g. a post permalink).
   *  Used to read a user's authoritative lifetime post count from the post profile. */
  getPostPage(url: string): Promise<string>;
  /** Lightweight diagnostic: is the forum reachable, and does the session look logged in? */
  checkConnectivity(): Promise<{ reachable: boolean; loggedIn: boolean }>;
}

/**
 * Pure HTML -> typed-record functions. No network, no state. Each takes the
 * raw HTML string returned by the matching PhpbbClient method. Must never throw
 * on unexpected/empty markup — return an empty array (or a best-effort record).
 */
export interface Parsers {
  parseForumIndex(html: string): Forum[];
  parseForum(html: string): TopicSummary[];
  parseTopic(html: string): Topic;
  parseSearch(html: string): SearchResult[];
  /** Parse an "all posts by a user" search-results page: total count + the page's posts. */
  parsePostSearch(html: string): AuthorPostsResult;
  /** Read a user's authoritative lifetime post count (e.g. "Posts: N") from the post-profile
   *  block of one of their posts on a topic page. Returns null if not found. */
  parseAuthorPostCount(html: string, author: string): number | null;
  /** Classify a phpBB notice/message page (why a search returned nothing).
   *  Returns null when the page is a normal results page. */
  detectNotice(html: string): SearchNotice | null;
  parseNotifications(html: string): Notification[];
  parsePrivateMessages(html: string): PrivateMessage[];
}
