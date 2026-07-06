import test from "node:test";
import assert from "node:assert/strict";

import { getConfig } from "../src/config.ts";

// Env vars getConfig reads, so each test can save/restore a clean slate.
const CONFIG_ENV_KEYS = [
  "PHPBB_SITE_NAME",
  "PHPBB_BASE_URL",
  "PHPBB_USERNAME",
  "PHPBB_PASSWORD",
  "PHPBB_POSTS_PER_PAGE",
  "PHPBB_TOPICS_PER_PAGE",
  "PHPBB_GUIDE_PATH",
] as const;

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const key of CONFIG_ENV_KEYS) prev[key] = process.env[key];
  try {
    for (const key of CONFIG_ENV_KEYS) delete process.env[key];
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) process.env[key] = value;
    }
    fn();
  } finally {
    for (const key of CONFIG_ENV_KEYS) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

test("getConfig reads the generic PHPBB env vars without requiring credentials", () => {
  withEnv(
    {
      PHPBB_SITE_NAME: "Example Forum",
      PHPBB_BASE_URL: "https://forum.example.com/forum/",
    },
    () => {
      assert.deepEqual(getConfig(), {
        siteName: "Example Forum",
        baseUrl: "https://forum.example.com/forum",
        username: "",
        password: "",
        postsPerPage: 25,
        topicsPerPage: 25,
        guidePath: "",
      });
    },
  );
});

test("getConfig infers the site name from the base URL host when unset", () => {
  withEnv({ PHPBB_BASE_URL: "https://www.forum.example.com/forum" }, () => {
    assert.equal(getConfig().siteName, "forum.example.com");
  });
});

test("getConfig honors PHPBB_POSTS_PER_PAGE / PHPBB_TOPICS_PER_PAGE overrides", () => {
  withEnv(
    {
      PHPBB_BASE_URL: "https://forum.example.com/forum",
      PHPBB_POSTS_PER_PAGE: "15",
      PHPBB_TOPICS_PER_PAGE: "50",
      PHPBB_GUIDE_PATH: "/tmp/custom-guide.md",
    },
    () => {
      const cfg = getConfig();
      assert.equal(cfg.postsPerPage, 15);
      assert.equal(cfg.topicsPerPage, 50);
      assert.equal(cfg.guidePath, "/tmp/custom-guide.md");
    },
  );
});

test("getConfig falls back to 25 per page for invalid overrides", () => {
  withEnv(
    {
      PHPBB_BASE_URL: "https://forum.example.com/forum",
      PHPBB_POSTS_PER_PAGE: "not-a-number",
      PHPBB_TOPICS_PER_PAGE: "0",
    },
    () => {
      const cfg = getConfig();
      assert.equal(cfg.postsPerPage, 25);
      assert.equal(cfg.topicsPerPage, 25);
    },
  );
});

test("getConfig throws when PHPBB_BASE_URL is missing", () => {
  withEnv({}, () => {
    assert.throws(() => getConfig(), /PHPBB_BASE_URL/);
  });
});

test("getConfig throws when PHPBB_BASE_URL is not a valid URL", () => {
  withEnv({ PHPBB_BASE_URL: "not a url" }, () => {
    assert.throws(() => getConfig(), /PHPBB_BASE_URL/);
  });
});
