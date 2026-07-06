import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createParsers } from "../src/phpbb/parse.ts";
import { parseForumDate } from "../src/phpbb/profile.ts";

const fixtures = (name: string) => readFileSync(join(process.cwd(), "fixtures", name), "utf8");

test("createParsers resolves forum URLs against the configured base URL", () => {
  const parsers = createParsers("https://www.diamondaviators.net/forum");
  const forums = parsers.parseForumIndex(fixtures("index.html"));

  assert.ok(forums.length > 0);
  assert.equal(forums[0]?.title, "Announcements");
  assert.equal(forums[0]?.url, "https://www.diamondaviators.net/forum/viewforum.php?f=1");
});

test("parsePostSearch works for an English-language phpBB board", () => {
  const parsers = createParsers("https://www.diamondaviators.net/forum");
  const result = parsers.parsePostSearch(fixtures("search_author.html"));

  assert.equal(result.total, 106);
  assert.equal(result.posts[0]?.author, "admin");
  assert.equal(result.posts[0]?.title, "Keep your DA40 in pristine condition");
  assert.match(
    result.posts[0]?.url ?? "",
    /diamondaviators\.net\/forum\/viewtopic\.php\?p=64673#p64673$/,
  );
});

test("parseForumDate understands English phpBB timestamps", () => {
  const parsed = parseForumDate("Monday May 25, 2026 2:18 am");

  assert.equal(parsed.dayOfWeek, "Monday");
  assert.equal(parsed.hour24, 2);
  assert.equal(parsed.month, 5);
  assert.equal(parsed.day, 25);
  assert.equal(parsed.year, 2026);
});
