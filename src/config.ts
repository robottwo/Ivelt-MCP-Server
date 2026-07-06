// Runtime configuration (site metadata + optional credentials), loaded from the environment.

import { config as loadEnv } from "dotenv";

loadEnv();

export interface PhpbbConfig {
  /** Human-friendly site name shown in server metadata/tool descriptions. */
  siteName: string;
  /** Optional forum account username. */
  username: string;
  /** Optional forum account password. */
  password: string;
  /** Forum base URL, no trailing slash, e.g. "https://forum.example.com/forum". */
  baseUrl: string;
  /** Posts per page in topic views and search results (phpBB "Posts per page" board setting). */
  postsPerPage: number;
  /** Topics per page in forum listings (phpBB "Topics per page" board setting). */
  topicsPerPage: number;
  /** Optional path to a custom site knowledge-base file served by the forum_guide tool.
   *  Empty string means "use the KNOWLEDGE.md that ships with this server". */
  guidePath: string;
}

function trimEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function inferSiteName(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.replace(/^www\./, "");
  } catch {
    return "phpBB forum";
  }
}

/** Parse a positive-integer env var, falling back to a default when unset/invalid. */
function positiveIntEnv(name: string, fallback: number): number {
  const raw = trimEnv(name);
  if (raw === "") return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Read config from the environment (.env).
 *
 * Required:
 *   - PHPBB_BASE_URL       — the forum's base URL (e.g. https://forum.example.com/forum)
 *
 * Optional:
 *   - PHPBB_SITE_NAME      — display name (defaults to the base URL's hostname)
 *   - PHPBB_USERNAME       — forum account, only needed for login-gated tools
 *   - PHPBB_PASSWORD
 *   - PHPBB_POSTS_PER_PAGE — posts per page on the board (default 25)
 *   - PHPBB_TOPICS_PER_PAGE — topics per page on the board (default 25)
 *   - PHPBB_GUIDE_PATH     — path to a custom forum_guide knowledge-base file
 */
export function getConfig(): PhpbbConfig {
  const rawBaseUrl = trimEnv("PHPBB_BASE_URL");
  if (rawBaseUrl === "") {
    throw new Error(
      "Missing required environment variable PHPBB_BASE_URL. " +
        "Set it to your forum's base URL, e.g. PHPBB_BASE_URL=https://forum.example.com/forum",
    );
  }
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  try {
    new URL(baseUrl);
  } catch {
    throw new Error(
      `PHPBB_BASE_URL is not a valid URL: "${rawBaseUrl}". ` +
        "Expected something like https://forum.example.com/forum",
    );
  }

  const siteName = trimEnv("PHPBB_SITE_NAME") || inferSiteName(baseUrl);
  const username = trimEnv("PHPBB_USERNAME");
  const password = process.env.PHPBB_PASSWORD ?? "";
  const postsPerPage = positiveIntEnv("PHPBB_POSTS_PER_PAGE", 25);
  const topicsPerPage = positiveIntEnv("PHPBB_TOPICS_PER_PAGE", 25);
  const guidePath = trimEnv("PHPBB_GUIDE_PATH");

  return { siteName, username, password, baseUrl, postsPerPage, topicsPerPage, guidePath };
}
