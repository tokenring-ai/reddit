# @tokenring-ai/reddit

## Overview

Reddit transport for TokenRing bots, plus research tools. This package connects Reddit accounts and
hands each one to [`@tokenring-ai/bot`](../bot) as a messaging provider — it carries comments and
private messages to and from Reddit. Separately, unauthenticated research tools (search, latest
posts, retrieve) remain available to agents.

Who a bot talks to, which subreddits it watches, and which agent answers are configured on the bot,
not here.

### Key Features

- **Multiple accounts**: run any number of Reddit accounts side by side
- **Inbox polling**: comment replies, username mentions, and private messages
- **Subreddit rooms**: bots join `reddit:r/{subreddit}` like other channel targets
- **Editable replies**: comments are edited in place as agent output streams (after the working stub)
- **Research tools**: `reddit_searchSubreddit`, `reddit_retrievePost`, `reddit_getLatestPosts`
- **Secrets**: tokens use the `@tokenring-ai/secrets` pattern

## Installation

```bash
bun add @tokenring-ai/reddit
```

Create a Reddit app at [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) (or an approved
developer app) and obtain OAuth credentials. Typical scopes: `identity`, `privatemessages`,
`submit`, `read`, `edit`.

## Configuration

```yaml
reddit:
  accounts:
    reddit:                               # service name bots address, e.g. reddit:alice
      accessToken: { source: env, env: REDDIT_ACCESS_TOKEN }
      # Or refresh-based auth:
      # refreshToken: { source: env, env: REDDIT_REFRESH_TOKEN }
      # clientId: your-client-id
      # clientSecret: { source: env, env: REDDIT_CLIENT_SECRET }
      pollIntervalMs: 30000
      maxMessageLength: 10000
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `accessToken` | secret | optional* | OAuth access token |
| `refreshToken` | secret | optional* | OAuth refresh token |
| `clientId` | string | optional | App client ID (with refreshToken) |
| `clientSecret` | secret | optional | App client secret (with refreshToken) |
| `pollIntervalMs` | number | `30000` | Inbox poll interval (min 10000) |
| `maxMessageLength` | number | `10000` | Longest comment/PM |
| `markRead` | boolean | `true` | Mark inbox items read after delivery |

\*Provide `accessToken`, or `refreshToken` + `clientId` + `clientSecret`.

Then point a bot at it:

```yaml
bot:
  bots:
    helper:
      agentType: assistant
      directMessages: anyone
      users:
        "reddit:alice": admin
      channels:
        programming:
          target: reddit:r/programming
```

Private messages use the bot's **direct message** policy. Public comment threads require a
**channel** whose target is `reddit:r/{subreddit}` (room id matches `r/{subreddit}` on inbound
messages).

### Connecting from chat

```
/connect reddit --name=reddit
```

### Addressing

| Target | Meaning |
|--------|---------|
| `reddit:{username}` | Private message that user |
| `reddit:r/{subreddit}` | Subreddit room / channel |
| `post:t3_…` / `pm:…` | Internal conversation ids |

### Streaming

ConversationStream's "working..." placeholder is held locally and never posted. The first real text
becomes a comment or PM; further updates use Reddit's edit API when possible.

## Research tools

These use the public JSON API and do not require a configured account:

- `reddit_searchSubreddit`
- `reddit_retrievePost`
- `reddit_getLatestPosts`

## Testing

```bash
bun test
```

## License

MIT License - see LICENSE file for details.
