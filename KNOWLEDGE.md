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

If you are deploying this for a specific board, replace this file with notes for that board.
