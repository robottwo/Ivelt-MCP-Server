# ivelt Knowledge Base

A living reference for working with the ivelt.com forum through this MCP server.
The `forum_guide` tool serves this file to the AI, so it has this context whenever
the tools are used.

> **How this grows:** this is a *curated, version-controlled* knowledge base — it is
> not auto-learned from end-user sessions (the server is read-only and never writes to
> GitHub). Maintainers extend it whenever a new Yiddish term, forum quirk, or usage tip
> is discovered, then commit. Add to the relevant section below and keep entries short.

---

## 1. Yiddish / Hebrew glossary (forum terms)

Forum UI and content are Yiddish/Hebrew (right-to-left, UTF-8). Common terms:

| Yiddish/Hebrew | Meaning |
|---|---|
| תגובות | posts / replies (a user's lifetime post count; also a topic's reply count) |
| געזען | views ("seen") |
| אשכול | topic / thread |
| פארום | forum / board section |
| זוך / זוכן | search / to search |
| דורך | "by" (author byline: "דורך <name>") |
| נאכאמאל | again |
| סעקונדע(ס) | second(s) |
| אינפארמאציע | "information" (heading on a phpBB notice/message page) |
| א דאנק | "a thanks" — the like/thanks button (login-gated; no public count) |

**Stock phrases worth recognizing:**
- `די זוך האט געפונען N רעזולטאטן` — "the search found N results."
- `מען קען נישט יעצט זוכן … פראבירט נאכאמאל אין N סעקונדעס` — search flood: "can't search now, try again in N seconds."
- `די פאלגנדע ווערטער … זייער שכיח'דיגע ווערטער` — "the following words … very common words" (ignored by search).
- `דו דארפסט זיין אריינגעלאגט …` — "you must be logged in …" (login-gated page).

**Days:** זונטאג Sun · מאנטאג Mon · דינסטאג Tue · מיטוואך Wed · דאנערשטאג Thu · פרייטאג Fri · שבת Sat
**Months:** יאנואר Jan · פעברואר Feb · מערץ Mar · אפריל Apr · מאי May · יוני Jun · יולי Jul · אויגוסט Aug · סעפטעמבער Sep · אקטאבער Oct · נאוועמבער Nov · דעצעמבער Dec

**Community/context terms** (helps interpret posts; extend over time): קרית יואל (Kiryas Joel), מאנסי (Monsey), היימיש (heimish/community), חסידיש (chasidish), נייעס (news).

---

## 2. How the forum works (phpBB 3.x, prosilver theme)

- **URL shapes:** `index.php`; `viewforum.php?f=<id>&start=<n>`; `viewtopic.php?t=<id>` (or `?p=<postid>#p<postid>`); `search.php?author=<name>&sr=posts|topics`, `&keywords=<kw>&sf=msgonly`; sort via `&sk=v|r|t&sd=d`.
- **25 per page everywhere** — topics, forum listings, and search all paginate at 25. Posts in a topic are **oldest-first**, so the newest are on the **last page** (`page = totalPages`); to see who posted most recently, read page 1 for `totalPages`, then request that page.
- **Sticky/announcement topics** sit at the top of a forum regardless of sort order.
- **Two different "total posts" numbers** (don't confuse them):
  - *Authoritative* (`user_posts`) — shown as "תגובות: N" in each post's profile block on a topic page. This is the true lifetime count.
  - *Search-result count* — filtered to what an unauthenticated reader can see; **undercounts** (omits restricted/trashed forums).
- **Search flood control:** ~15 seconds between searches; otherwise returns the "try again in N seconds" notice. (The client caches results and waits-and-retries automatically.)
- **Keyword search ignores** words under 4 letters and very common words.

### What's public vs login-gated
- **Public (works):** browsing forums, reading topics, search, topic **view counts**.
- **Login-gated (NOT reachable — Cloudflare blocks the login page):** the member list, user profiles, notifications, private messages, and **likes/"thanks" counts** (only the button shows to guests).

---

## 3. How to get information (tool playbook)

| Question | Tool |
|---|---|
| How many posts has X written? | `posts_by_author` → `totalPosts` (authoritative), `visiblePosts`, `hiddenFromScraper` |
| What topics did X start? Most-viewed of theirs? | `topics_by_author` (includes view/reply counts — rank by `views`) |
| Understand / profile a user | `profile_user` (overview-first, sectioned, cited; includes a fun section) |
| Most-viewed topics in a forum | `list_topics(forumId, sort: "views")` |
| Search the forum for a subject | `search_posts` (use ≥4-letter, specific, non-common keywords; Yiddish script matches best) |
| What did X say about Y? | `posts_by_author(author, keywords: "Y")` |
| Read a discussion (with attachments) | `read_topic(topicId)` |
| Is the forum reachable / logged in? | `health_check` |

**Tips:**
- Always cite the source link (`url`) for what you report.
- If a search returns nothing, read the `note` — it says *why* (words ignored, flood, login required, or no matches).
- "Most viewed" applies to **topics** (posts don't have individual view counts). "Most liked" is **not available** (login-gated).

---

## 4. Known limitations

- No likes/thanks counts; no member list, profiles, notifications, or PMs (all login-gated).
- No board-wide "most viewed across all forums" (per-forum sorting only).
- phpBB search has no date-range filter.
- Parsing depends on the forum's HTML; a theme change can require updating selectors.
