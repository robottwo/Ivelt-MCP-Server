// Record shapes returned by the parsers and surfaced by the MCP tools.
//
// ivelt.com is a phpBB 3.x forum (prosilver theme, right-to-left Yiddish/Hebrew).
// All text fields may contain Yiddish/Hebrew (UTF-8) — never assume ASCII.

/** A forum section on the board index. */
export interface Forum {
  /** phpBB forum id (the f= value), as a string. */
  id: string;
  /** Forum name, e.g. "וועלטליכע נייעס". */
  title: string;
  /** Absolute URL to the forum. */
  url: string;
  /** Short description under the title, if present. */
  description: string | null;
  /** Category heading this forum sits under, if any. */
  category: string | null;
}

/** One topic row as listed inside a forum or a search/active-topics result. */
export interface TopicSummary {
  /** phpBB topic id (the t= value), as a string. */
  id: string;
  /** Topic title. */
  title: string;
  /** Absolute URL to the topic. */
  url: string;
  /** Display name of the topic starter, if shown. */
  author: string | null;
  /** Reply count, if shown. */
  replies: number | null;
  /** View count, if shown. */
  views: number | null;
  /** Forum this topic belongs to, if shown (common in search results). */
  forumTitle: string | null;
  /** Last-post date/time as the raw text shown on the page. */
  lastPostAt: string | null;
}

/** A single post inside a topic. */
export interface Post {
  /** phpBB post id (the p= value), as a string, if available. */
  id: string | null;
  /** Author display name. */
  author: string | null;
  /** Post date/time as the raw text shown on the page. */
  postedAt: string | null;
  /** Post body as plain text (HTML stripped, quotes/signatures best-effort kept readable). */
  text: string;
  /** Absolute permalink to this post, if available. */
  url: string | null;
  /** Files and inline images attached to the post (download links + image src), if any. */
  attachments: Attachment[];
}

/** A file or image attached to a post. */
export interface Attachment {
  /** Display name / filename, if known. */
  name: string;
  /** Absolute URL to the attachment (download link or image src). */
  url: string;
}

/** A full topic view (one page of posts). */
export interface Topic {
  /** phpBB topic id (t=), as a string. */
  id: string;
  /** Topic title. */
  title: string;
  /** Absolute URL to the topic. */
  url: string;
  /** Posts on this page, in display order. */
  posts: Post[];
  /** 1-based page number currently shown. */
  page: number;
  /** Total number of pages in the topic, if determinable. */
  totalPages: number | null;
}

/** One search-result row. Structurally close to TopicSummary but kept distinct
 *  because search results often include a matched-text snippet. */
export interface SearchResult {
  /** phpBB topic id (t=), as a string, if available. */
  topicId: string | null;
  /** Topic title. */
  title: string;
  /** Absolute URL to the topic (or matched post). */
  url: string;
  /** Forum the result is in, if shown. */
  forumTitle: string | null;
  /** Author of the matched post/topic, if shown. */
  author: string | null;
  /** Matched-text snippet / preview, if shown. */
  snippet: string | null;
  /** Date/time as the raw text shown on the page. */
  postedAt: string | null;
}

/** Result of an "all posts by a user" search: the total post count phpBB
 *  reports ("found N results") plus the posts on the requested page. */
export interface AuthorPostsResult {
  /** Total number of posts the user has written (across the whole forum),
   *  as reported by the search results heading. null if not determinable. */
  total: number | null;
  /** The posts on the current page (each row of the search results). */
  posts: SearchResult[];
}

/** One entry from the logged-in user's notifications list (ucp notifications). */
export interface Notification {
  /** Notification text, e.g. "X quoted you in topic Y". */
  text: string;
  /** Absolute URL the notification links to, if any. */
  url: string | null;
  /** Time as the raw text shown on the page. */
  time: string | null;
  /** True if the notification is unread, when determinable. */
  unread: boolean | null;
}

/** One private message from the logged-in user's inbox. */
export interface PrivateMessage {
  /** Message subject. */
  subject: string;
  /** Sender display name, if shown. */
  from: string | null;
  /** Sent date/time as the raw text shown on the page. */
  sentAt: string | null;
  /** Absolute URL to read the message, if any. */
  url: string | null;
  /** True if unread, when determinable. */
  unread: boolean | null;
}
