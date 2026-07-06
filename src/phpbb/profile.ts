// Aggregates a user's PUBLIC phpBB posts into an activity/interest profile.
// Pure functions over already-parsed SearchResult records (no network). Used by
// the profile_user MCP tool. Everything here derives only from what the user
// posted publicly on the forum — no identity/PII inference.

import type { SearchResult } from "../types.js";

export interface UserProfile {
  author: string;
  /** Total posts on the forum (from the search heading), independent of how many we analyzed. */
  totalPosts: number | null;
  /** Total topics the user has STARTED (from the topics-search heading). */
  topicsStarted: number | null;
  /** How many posts were actually fetched + analyzed for this profile. */
  postsAnalyzed: number;
  pagesFetched: number;
  /** True if we hit the page cap before collecting every post. */
  truncated: boolean;
  /** Earliest / latest post date we saw (raw forum text), by parsed order. */
  dateRange: { earliest: string | null; latest: string | null };
  /** Post counts per forum, most-active first — the user's interests. */
  forums: { forum: string; count: number }[];
  /** Most-engaged topics, most-active first. */
  topTopics: { title: string; topicId: string | null; url: string; count: number }[];
  /** Posting counts by hour 0–23, in the forum's displayed clock (not necessarily the user's local time). */
  activeHours: Record<string, number>;
  /** Posting counts by day of week. */
  activeDaysOfWeek: Record<string, number>;
  /** A sample of posts (with snippets) so the reader can judge interests/content. */
  samplePosts: SearchResult[];
}

const DOW: Record<string, string> = {
  Sunday: "Sunday",
  Monday: "Monday",
  Tuesday: "Tuesday",
  Wednesday: "Wednesday",
  Thursday: "Thursday",
  Friday: "Friday",
  Saturday: "Saturday",
  זונטאג: "Sunday",
  מאנטאג: "Monday",
  דינסטאג: "Tuesday",
  מיטוואך: "Wednesday",
  דאנערשטאג: "Thursday",
  פרייטאג: "Friday",
  שבת: "Saturday",
};

const MONTHS: Record<string, number> = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
  יאנואר: 1,
  פעברואר: 2,
  מערץ: 3,
  אפריל: 4,
  מאי: 5,
  יוני: 6,
  יולי: 7,
  אויגוסט: 8,
  סעפטעמבער: 9,
  אקטאבער: 10,
  נאוועמבער: 11,
  דעצעמבער: 12,
};

export interface ParsedDate {
  dayOfWeek: string | null;
  hour24: number | null;
  year: number | null;
  month: number | null;
  day: number | null;
  /** Sortable key (year/month/day/time) for ordering; null if no year. */
  sortKey: number | null;
}

/** Best-effort parse of common phpBB date strings. Supports both English and the
 * original ivelt Yiddish/Hebrew forum date words. */
export function parseForumDate(text: string | null | undefined): ParsedDate {
  const empty: ParsedDate = {
    dayOfWeek: null,
    hour24: null,
    year: null,
    month: null,
    day: null,
    sortKey: null,
  };
  if (!text) return empty;
  const t = text.trim();

  let dayOfWeek: string | null = null;
  for (const [label, english] of Object.entries(DOW)) {
    if (t.startsWith(label)) {
      dayOfWeek = english;
      break;
    }
  }

  let hour24: number | null = null;
  const tm = t.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (tm) {
    let h = parseInt(tm[1], 10);
    const ap = tm[3].toLowerCase();
    if (ap === "pm" && h !== 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (h >= 0 && h <= 23) hour24 = h;
  }

  const ym = t.match(/,\s*(\d{4})/);
  const year = ym ? parseInt(ym[1], 10) : null;

  let month: number | null = null;
  for (const [label, n] of Object.entries(MONTHS)) {
    if (t.includes(label)) {
      month = n;
      break;
    }
  }

  let day: number | null = null;
  const dm = t.match(/(\d{1,2}),\s*\d{4}/);
  if (dm) day = parseInt(dm[1], 10);

  let sortKey: number | null = null;
  if (year !== null) {
    sortKey =
      year * 1e8 +
      (month ?? 0) * 1e6 +
      (day ?? 0) * 1e4 +
      (hour24 ?? 0) * 100;
  }

  return { dayOfWeek, hour24, year, month, day, sortKey };
}

// Backward-compatibility alias for callers still using the old name.
export const parseIveltDate = parseForumDate;

/** Build the aggregate profile from collected posts. */
export function summarizePosts(
  author: string,
  totalPosts: number | null,
  posts: SearchResult[],
  pagesFetched: number,
  topicsStarted: number | null = null,
): UserProfile {
  const forumCounts = new Map<string, number>();
  const topicCounts = new Map<
    string,
    { title: string; topicId: string | null; url: string; count: number }
  >();
  const activeHours: Record<string, number> = {};
  const activeDaysOfWeek: Record<string, number> = {};

  let earliest: { key: number; text: string } | null = null;
  let latest: { key: number; text: string } | null = null;

  for (const p of posts) {
    if (p.forumTitle) {
      forumCounts.set(p.forumTitle, (forumCounts.get(p.forumTitle) ?? 0) + 1);
    }

    const topicKey = p.topicId ?? p.url;
    const existing = topicCounts.get(topicKey);
    if (existing) existing.count++;
    else {
      topicCounts.set(topicKey, {
        title: p.title.replace(/^Re:\s*/i, "").trim() || p.title,
        topicId: p.topicId,
        url: p.url,
        count: 1,
      });
    }

    const d = parseForumDate(p.postedAt);
    if (d.hour24 !== null) {
      const k = String(d.hour24);
      activeHours[k] = (activeHours[k] ?? 0) + 1;
    }
    if (d.dayOfWeek) {
      activeDaysOfWeek[d.dayOfWeek] = (activeDaysOfWeek[d.dayOfWeek] ?? 0) + 1;
    }
    if (d.sortKey !== null && p.postedAt) {
      if (!earliest || d.sortKey < earliest.key) earliest = { key: d.sortKey, text: p.postedAt };
      if (!latest || d.sortKey > latest.key) latest = { key: d.sortKey, text: p.postedAt };
    }
  }

  const forums = [...forumCounts.entries()]
    .map(([forum, count]) => ({ forum, count }))
    .sort((a, b) => b.count - a.count);

  const topTopics = [...topicCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return {
    author,
    totalPosts,
    topicsStarted,
    postsAnalyzed: posts.length,
    pagesFetched,
    truncated: totalPosts !== null && posts.length < totalPosts,
    dateRange: { earliest: earliest?.text ?? null, latest: latest?.text ?? null },
    forums,
    topTopics,
    activeHours,
    activeDaysOfWeek,
    samplePosts: posts.slice(0, 15),
  };
}
