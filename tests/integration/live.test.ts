// Live integration tests against well-known, public phpBB 3.x boards.
//
// These hit the real internet, so they are deliberately NOT part of `npm test`:
// run them with `npm run test:integration` (CI runs them on a schedule, not on
// every PR — see .github/workflows/integration.yml).
//
// Design rules:
//  - A board being unreachable/blocked SKIPS its tests (third-party downtime or
//    a WAF change must not redline our CI); a reachable board that PARSES WRONG
//    fails them (that's a real regression in our selectors).
//  - Assertions are structural invariants (non-empty lists, absolute URLs on the
//    right origin, posts with text), never exact content — live data changes.
//  - Request budget is tiny (typically 4 requests per board, at most 6) and the
//    client already enforces a polite ~1s gap and a desktop User-Agent.

import test from "node:test";
import assert from "node:assert/strict";

import { createPhpbbClient } from "../../src/phpbb/client.ts";
import { createParsers } from "../../src/phpbb/parse.ts";
import type { PhpbbConfig } from "../../src/config.ts";
import type { TopicSummary } from "../../src/types.ts";

interface Target {
  siteName: string;
  baseUrl: string;
}

// Well-known public phpBB 3.x boards (prosilver). Add more here as needed;
// each target costs a handful of polite requests per run.
const TARGETS: Target[] = [
  { siteName: "phpBB Community", baseUrl: "https://www.phpbb.com/community" },
  { siteName: "VideoLAN Forums", baseUrl: "https://forum.videolan.org" },
];

function configFor(t: Target): PhpbbConfig {
  return {
    siteName: t.siteName,
    baseUrl: t.baseUrl,
    username: "",
    password: "",
    postsPerPage: 25,
    topicsPerPage: 25,
    guidePath: "",
  };
}

for (const target of TARGETS) {
  test(`live: ${target.siteName} (${target.baseUrl})`, { timeout: 120_000 }, async (t) => {
    const config = configFor(target);
    const client = createPhpbbClient(config);
    const parsers = createParsers(config.baseUrl);
    const origin = new URL(config.baseUrl).origin;

    // Reachability gate: skip (not fail) only when the request itself fails —
    // board down, DNS, WAF block, no egress. If HTML comes back, the parse
    // assertions below run, so selector regressions are never masked as skips.
    // Fetched once, shared across the subtests to keep the request budget low.
    let indexHtml: string;
    try {
      indexHtml = await client.getForumIndex();
    } catch (err) {
      t.skip(`${target.siteName} unreachable from this network — skipping (${err})`);
      return;
    }
    let topicsOfOneForum: TopicSummary[] = [];

    await t.test("board index parses into forums", () => {
      const forums = parsers.parseForumIndex(indexHtml);
      assert.ok(forums.length > 0, "expected at least one forum on the board index");
      for (const f of forums) {
        assert.match(f.id, /^\d+$/, `forum id should be numeric: ${JSON.stringify(f)}`);
        assert.ok(f.url.startsWith(origin), `forum URL should be absolute on ${origin}: ${f.url}`);
        assert.notEqual(f.title.trim(), "");
      }
    });

    await t.test("a forum listing parses into topics", async () => {
      const forums = parsers.parseForumIndex(indexHtml);
      // Some index entries are category links or empty sections; find the
      // first forum whose listing yields topics (bounded to keep politeness).
      for (const f of forums.slice(0, 3)) {
        const topics = parsers.parseForum(await client.getForum(f.id));
        if (topics.length > 0) {
          topicsOfOneForum = topics;
          for (const topic of topics) {
            assert.ok(
              topic.url.startsWith(origin),
              `topic URL should be absolute on ${origin}: ${topic.url}`,
            );
            assert.notEqual(topic.title.trim(), "");
          }
          return;
        }
      }
      assert.fail("none of the first 3 forums produced any parsed topics");
    });

    await t.test("a topic parses into posts", async () => {
      const withId = topicsOfOneForum.find((tp) => tp.id !== "");
      assert.ok(withId, "expected a topic with a numeric id from the previous step");
      const topic = parsers.parseTopic(await client.getTopic(withId.id));
      assert.equal(topic.id, withId.id);
      assert.ok(topic.posts.length > 0, "expected at least one post in the topic");
      for (const post of topic.posts) {
        assert.notEqual(post.text.trim(), "", "post body should be non-empty");
      }
      assert.ok(
        topic.posts.some((p) => p.author && p.author.trim() !== ""),
        "expected at least one post with an author",
      );
      assert.ok(topic.totalPages !== null && topic.totalPages >= 1);
    });
  });
}
