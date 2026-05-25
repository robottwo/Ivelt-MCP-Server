// Runtime configuration (credentials + base URL), loaded from the environment.

import { config as loadEnv } from "dotenv";

loadEnv();

export interface IveltConfig {
  /** ivelt.com account username. */
  username: string;
  /** ivelt.com account password. */
  password: string;
  /** Forum base URL, no trailing slash, e.g. "https://www.ivelt.com/forum". */
  baseUrl: string;
}

const DEFAULT_BASE_URL = "https://www.ivelt.com/forum";

/**
 * Read config from the environment (.env). Throws if credentials are missing,
 * so the failure is obvious at startup rather than on the first request.
 */
export function getConfig(): IveltConfig {
  const username = process.env.IVELT_USERNAME?.trim() ?? "";
  const password = process.env.IVELT_PASSWORD ?? "";
  const baseUrl = (process.env.IVELT_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
  if (!username || !password) {
    throw new Error(
      "Missing ivelt credentials: set IVELT_USERNAME and IVELT_PASSWORD in .env",
    );
  }
  return { username, password, baseUrl };
}
