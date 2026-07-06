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
  /** Forum base URL, no trailing slash, e.g. "https://www.ivelt.com/forum". */
  baseUrl: string;
}

// Backward-compatibility alias for the original ivelt-specific name.
export type IveltConfig = PhpbbConfig;

const DEFAULT_BASE_URL = "https://www.ivelt.com/forum";

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

/**
 * Read config from the environment (.env).
 *
 * Preferred generic vars:
 *   - PHPBB_SITE_NAME
 *   - PHPBB_BASE_URL
 *   - PHPBB_USERNAME
 *   - PHPBB_PASSWORD
 *
 * Legacy ivelt vars remain supported for backward compatibility:
 *   - IVELT_BASE_URL
 *   - IVELT_USERNAME
 *   - IVELT_PASSWORD
 */
export function getConfig(): PhpbbConfig {
  const baseUrl = (trimEnv("PHPBB_BASE_URL") || trimEnv("IVELT_BASE_URL") || DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const siteName = trimEnv("PHPBB_SITE_NAME") || inferSiteName(baseUrl);
  const username = trimEnv("PHPBB_USERNAME") || trimEnv("IVELT_USERNAME");
  const password = process.env.PHPBB_PASSWORD ?? process.env.IVELT_PASSWORD ?? "";

  return { siteName, username, password, baseUrl };
}
