# ivelt MCP Server

A local [Model Context Protocol](https://modelcontextprotocol.io) server that lets **Claude** read the **[ivelt.com](https://www.ivelt.com)** forum — a Yiddish/Hebrew [phpBB](https://www.phpbb.com) community board.

ivelt has no API, so this server reads the ordinary public forum pages and turns them into clean, structured results Claude can use. It is **read-only** — it never posts, replies, or messages — and it runs entirely on your own machine.

## What it can do

Ask Claude things like:

- *"Search ivelt for posts about [topic]."*
- *"List the forum sections on ivelt."*
- *"Show the recent topics in forum 70."*
- *"Read topic 81991 and summarize the discussion."*
- *"How many posts has the user [username] written, and what are they about?"*
- *"Build an activity profile of the ivelt user [username]."*

All forum content is in **Yiddish/Hebrew**, so results come back in those languages — Claude can translate or summarize them for you.

## How it works

```
ivelt.com (phpBB)  ──HTML──▶  HTTP client (browser UA, session, rate-limited)
                                   │  raw HTML
                                   ▼
                              HTML parsers (cheerio)  ──records──▶  MCP tools  ──▶  Claude
```

Each tool call fetches the relevant page live and parses it, so answers reflect the forum as it is right now. There is no database or cache.

## Requirements

- [Node.js](https://nodejs.org) 22 or newer
- A desktop MCP client — these instructions assume **Claude Desktop**

## Quick start

**1. Get the code.** Clone the repo, or download the ZIP and unzip it into a folder — e.g. `C:\ivelt-mcp`.

**2. Install and build.** Open a terminal *in that folder* and run:

```bash
npm install
npm run build
```

This compiles the server to `dist/` (it creates `dist/index.js`, which Claude will launch).

**3. Add it to Claude Desktop.** Open Claude Desktop → **Settings → Developer → Edit Config**. That opens `claude_desktop_config.json`. Add the `ivelt` entry below, using the **absolute path** to your folder with **forward slashes**:

```json
{
  "mcpServers": {
    "ivelt": {
      "command": "node",
      "args": ["--use-system-ca", "C:/ivelt-mcp/dist/index.js"]
    }
  }
}
```

If you already have other servers, just add the `"ivelt": { ... }` block inside the existing `mcpServers` object (separate each entry with a comma).

**4. Restart Claude Desktop.** Fully quit it (from the system tray — not just closing the window) and reopen it. The ivelt tools will load.

**5. Try it.** Ask Claude, for example: *"List the forum sections on ivelt"* or *"Build an activity profile of the ivelt user [username]."*

> **About `--use-system-ca`:** it tells Node to trust your operating system's certificate store. It's harmless on a normal connection and is needed on networks behind a TLS-inspecting proxy (common on corporate/MSP networks). You can drop it if you don't need it.

> **macOS/Linux:** the config file is at `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `~/.config/Claude/claude_desktop_config.json` (Linux), and your path would look like `/Users/you/ivelt-mcp/dist/index.js`.

## Tools

All tools are **read-only**.

| Tool | What it returns |
|---|---|
| `search_posts(keywords, page?)` | Posts matching keywords (title, link, forum, author, snippet, date). |
| `topics_by_author(author, page?)` | Topics **started** by a username. |
| `posts_by_author(author, page?)` | A user's posts (replies + starts) plus their **total post count**. |
| `profile_user(author, maxPages?)` | A public **activity profile**: total posts, interests (posts per forum), top topics, an active-hours histogram, active days, and date range. |
| `read_topic(topicId, page?)` | One page of a topic's posts (author, date, text, permalink). |
| `list_forums()` | All forum sections from the board index. |
| `list_topics(forumId, page?)` | Topics inside a forum. |
| `my_notifications()` | Your notifications — **login required (see Limitations).** |
| `my_messages()` | Your private-message inbox — **login required (see Limitations).** |

## Optional: logged-in features

`my_notifications` and `my_messages` need a logged-in session. To try them, copy `.env.example` to `.env` and add your ivelt username/password, **or** put them in the config `env` block. See **Limitations** below — these currently don't work, and the other tools need no login.

## Limitations

- **The login-only tools don't work.** ivelt sits behind Cloudflare, which blocks the login page for automated requests. So `my_notifications` / `my_messages` will return an error. Everything else (search, browse, read, author/profile tools) is **public** and works without any login.
- **Keyword search ignores short/common words.** The forum's search drops words under 4 letters and very common words. For "what topics did user X start / how many posts," use `topics_by_author` / `posts_by_author` instead of keyword search.
- **It parses HTML.** If ivelt changes its forum theme, a parser may need updating.
- **Be polite.** The client sends a normal browser User-Agent and limits itself to about one request per second. Don't hammer the forum.

## Responsible use

This server reads only **public** forum content — the same pages any visitor can see. The profiling tools summarize what a user chose to post publicly (their topics, interests, and posting times). They do **not** determine anyone's real identity, address, or phone number, and you shouldn't try to use this to de-anonymize, track, or harass people. Respect the community and ivelt's terms of use.

## License

[MIT](LICENSE) — free to use, modify, and share, with attribution.
