# Forum Guide

This file is the optional **site-specific knowledge base** for the MCP server.

By default, the generic phpBB tools do not need any custom guide. But if you adapt this server to a particular community, this is the place to document:

- forum-specific vocabulary or acronyms
- which subforums matter most
- login quirks / WAF behavior
- theme-specific parser gotchas
- recommended workflows for that board

## Suggested contents for a customized deployment

### 1. Forum overview

- What site this is
- Whether it is public or login-gated
- Whether search works anonymously

### 2. Important forums

- forum IDs and what they contain
- which ones are noisy vs high signal

### 3. Language notes

- English only?
- mixed language?
- board-specific jargon?

Example (for a Yiddish/Hebrew board like the one this server was first built for):
"The forum is written in Yiddish/Hebrew, so search keywords match best in
Hebrew script. phpBB search also ignores words shorter than 4 letters and very
common words, so short/common single terms return nothing."

### 4. Tool playbook

- `list_forums()` to discover forum ids
- `list_topics(forumId)` to browse a section
- `read_topic(topicId)` to inspect a thread
- `search_posts(keywords)` for topic-wide recall
- `topics_by_author(author)` / `posts_by_author(author)` for user research
- `profile_user(author)` for a quick public activity summary
- `health_check()` when results are empty or login-only tools fail

### 5. Known limitations

- WAF / Cloudflare blocks
- hidden forums not visible to anonymous scraping
- theme changes that break selectors

Examples of board-specific caveats worth recording here (these were once baked
into the tool descriptions but are site-specific, so they live in the guide now):

- **Login blocked:** some boards front the login page with Cloudflare/a WAF that
  returns 403 to automated requests, so `my_notifications` / `my_messages` don't
  work. Browsing, reading, and search all work anonymously.
- **"Thanks"/like counts not public:** some boards only show the thanks button to
  logged-in users, so there is no public per-topic thanks count to read.

If you are deploying this for a specific board, replace this file with notes for that board.
