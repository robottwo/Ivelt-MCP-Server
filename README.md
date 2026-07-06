# phpBB MCP Server

A local [Model Context Protocol](https://modelcontextprotocol.io) server for **read-only access to phpBB forums**.

It fetches ordinary phpBB HTML pages, parses them into structured results, and exposes that data as MCP tools. No posting, replying, messaging, or moderation side effects.

## What changed

This fork generalizes the original ivelt-only project into a **configurable multi-site phpBB MCP**:

- configurable `PHPBB_BASE_URL`
- configurable `PHPBB_SITE_NAME`
- parser factory that resolves links against the configured forum
- date parsing that works for both **English** phpBB timestamps and the original **ivelt** Yiddish/Hebrew timestamps
- backward compatibility for legacy `IVELT_*` env vars

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

Create a `.env` file or inject these variables via your MCP client config:

```env
PHPBB_SITE_NAME=Diamond Aviators
PHPBB_BASE_URL=https://www.diamondaviators.net/forum
PHPBB_USERNAME=
PHPBB_PASSWORD=
```

### Backward compatibility

These legacy env vars still work:

```env
IVELT_BASE_URL=https://www.ivelt.com/forum
IVELT_USERNAME=...
IVELT_PASSWORD=...
```

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
      "args": ["--use-system-ca", "/absolute/path/to/Ivelt-MCP-Server/dist/index.js"],
      "env": {
        "PHPBB_SITE_NAME": "Diamond Aviators",
        "PHPBB_BASE_URL": "https://www.diamondaviators.net/forum"
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
| `forum_guide()` | Contents of `KNOWLEDGE.md`, intended for site-specific notes/customizations. |

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
- generic env-var config
- backward compatibility for ivelt env vars
- configurable URL resolution against another board
- English-language phpBB parsing
- configurable MCP server identity

## License

[MIT](LICENSE)
