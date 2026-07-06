# phpBB MCP Server

A local [Model Context Protocol](https://modelcontextprotocol.io) server for **read-only access to phpBB forums**.

It fetches ordinary phpBB HTML pages, parses them into structured results, and exposes that data as MCP tools. No posting, replying, messaging, or moderation side effects.

It is **site-agnostic**: point it at any phpBB 3.x board (prosilver theme) via configuration. The parsers were verified against English and Yiddish/Hebrew (right-to-left) boards, and the date/flood-notice patterns document how to extend them for other language packs.

## One board per server instance

This server models **one forum per running instance**. To serve several boards, run several instances, each with its own `PHPBB_BASE_URL` (and its own MCP entry in your client config). This keeps each instance's session, rate-limiting, and knowledge base cleanly scoped to a single board.

## What it can do

- search posts by keyword
- list forums
- list topics in a forum
- read a topic
- list topics started by a given author
- list posts by a given author
- build a public activity profile for an author
- optionally read notifications / private messages when login works on the target board

## Requirements

- Node.js 22+
- An MCP client such as Claude Desktop or Hermes

## Configuration

Create a `.env` file (see `.env.example`) or inject these variables via your MCP client config:

```env
# Required
PHPBB_BASE_URL=https://forum.example.com

# Optional
PHPBB_SITE_NAME=Example Forum   # defaults to the base URL's hostname
PHPBB_USERNAME=                 # only for the login-gated tools
PHPBB_PASSWORD=
PHPBB_POSTS_PER_PAGE=25         # override if your board isn't the phpBB default of 25
PHPBB_TOPICS_PER_PAGE=25
PHPBB_GUIDE_PATH=./KNOWLEDGE.md # custom forum_guide file (falls back to bundled KNOWLEDGE.md)
```

`PHPBB_BASE_URL` is **required** — the server fails fast at startup with a clear error if it is missing or unparseable.

## Install and build

```bash
npm install
npm run test
npm run build
```

## Claude Desktop example

```json
{
  "mcpServers": {
    "phpbb": {
      "command": "node",
      "args": ["--use-system-ca", "/absolute/path/to/phpbb-mcp-server/dist/index.js"],
      "env": {
        "PHPBB_SITE_NAME": "Example Forum",
        "PHPBB_BASE_URL": "https://forum.example.com"
      }
    }
  }
}
```

## Tools

| Tool | What it returns |
|---|---|
| `search_posts(keywords, page?)` | Posts matching keywords (title, link, forum, author, snippet, date). |
| `topics_by_author(author, page?)` | Topics started by a username, with reply + view counts. |
| `posts_by_author(author, page?, keywords?)` | A user's visible posts plus authoritative/visible post-count handling when available. |
| `profile_user(author, maxPages?)` | Public activity profile: post totals, topics started, interests, top topics, active hours/days, and sample posts. |
| `read_topic(topicId, page?)` | One page of a topic's posts, including attachments/images when available. |
| `list_forums()` | All forum sections from the board index. |
| `list_topics(forumId, page?, sort?)` | Topics inside a forum. |
| `my_notifications()` | Notifications for the logged-in user, if login succeeds on the target board. |
| `my_messages()` | Private-message inbox for the logged-in user, if login succeeds on the target board. |
| `health_check()` | Reachability + logged-in-session diagnostic. |
| `forum_guide()` | This deployment's optional site knowledge base — `KNOWLEDGE.md` (or the file named by `PHPBB_GUIDE_PATH`), intended for site-specific notes/customizations. |

## Notes

- Many phpBB forums are public for read/search but block automated login with Cloudflare or other WAF layers.
- The login-only tools are therefore **best-effort**, not guaranteed.
- phpBB search often ignores short/common words.
- This project parses HTML. Theme/layout changes may require selector updates.

## Testing

This fork includes a small automated test suite:

```bash
npm run test
```

The tests cover:
- generic env-var config, including required-variable and page-size handling
- configurable URL resolution against another board
- English-language phpBB parsing
- configurable MCP server identity
- an assertion that no registered tool or the server instructions mention the original single-site name

## License

[MIT](LICENSE)
