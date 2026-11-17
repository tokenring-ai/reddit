# @tokenring-ai/reddit

## Overview

Reddit transport for TokenRing bots, plus research tools. This package connects Reddit accounts and
hands each one to [`@tokenring-ai/bot`](../bot) as a messaging provider — it carries comments and
private messages to and from Reddit. Separately, unauthenticated research tools (search, latest
posts, retrieve) remain available to agents.

Who a bot talks to, which subreddits it watches, and which agent answers are configured on the bot,
not here. See the `@tokenring-ai/bot` README for that half.

### Key Features

- **Multiple accounts**: run any number of Reddit accounts side by side
- **Inbox polling**: comment replies, username mentions, and private messages
- **Subreddit rooms**: bots join `reddit:r/{subreddit}` like other channel targets
- **Editable replies**: comments are edited in place as agent output streams (after the working stub)
- **OAuth refresh**: access tokens can be refreshed automatically via a refresh token plus client credentials
- **Research tools**: `reddit_searchSubreddit`, `reddit_retrievePost`, `reddit_getLatestPosts`
- **Scripting functions**: `searchSubreddit`, `getRedditPost`, `getLatestPosts`
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

| Field               | Type      | Required | Default                                              | Description                                                                 |
|---------------------|-----------|----------|------------------------------------------------------|-----------------------------------------------------------------------------|
| `accessToken`       | `secret`  | no\*     | —                                                    | OAuth access token (Bearer)                                                 |
| `refreshToken`      | `secret`  | no\*     | —                                                    | OAuth refresh token                                                          |
| `clientId`          | `string`  | no       | —                                                    | Reddit app client ID (required with `refreshToken`)                         |
| `clientSecret`      | `secret`  | no       | —                                                    | Reddit app client secret (required with `refreshToken`)                     |
| `oauthBaseUrl`      | `string`  | no       | `https://oauth.reddit.com`                           | Reddit OAuth API base URL                                                   |
| `tokenUrl`          | `string`  | no       | `https://www.reddit.com/api/v1/access_token`         | OAuth token endpoint                                                         |
| `userAgent`         | `string`  | no       | `TokenRing-One/1.0 (https://github.com/tokenring-ai/one)` | User-Agent sent with Reddit API requests (Reddit requires a descriptive UA) |
| `pollIntervalMs`    | `number`  | no       | `30000`                                              | How often, in ms, to poll the inbox (min `10000`)                           |
| `maxMessageLength`  | `number`  | no       | `10000`                                              | Longest single comment or PM (1–10000)                                      |
| `markRead`          | `boolean` | no       | `true`                                               | Mark inbox items as read after delivering them to a bot                     |

\*Provide `accessToken`, or `refreshToken` + `clientId` + `clientSecret`.

Service-level fields under `reddit`:

| Field            | Type     | Default                                              | Description                                           |
|------------------|----------|------------------------------------------------------|-------------------------------------------------------|
| `accounts`       | `record` | `{}`                                                 | Reddit accounts, keyed by the service name bots address them by |
| `publicBaseUrl`  | `string` | `https://www.reddit.com`                             | Public Reddit base URL used by research tools (search, latest posts, post retrieval) |
| `userAgent`      | `string` | `TokenRing-One/1.0 (https://github.com/tokenring-ai/one)` | Default User-Agent for public (unauthenticated) API calls |

`accessToken`, `refreshToken`, and `clientSecret` are secret references resolved by
`@tokenring-ai/secrets` before an account connects. They can be a literal string in the config,
`{ source: env, env: <name> }` to read an environment variable, or
`{ source: vault, category, key }` to read from the credential vault. This package does not read
environment variables itself — point secrets at them with `{ source: env, env: ... }`.

Then point a bot at it:

```yaml
bot:
  bots:
    helper:
      agentType: assistant
      directMessages: listed          # only the users below may DM it
      users:
        "reddit:alice": admin
      channels:
        programming:
          target: reddit:r/programming
```

Private messages use the bot's **direct message** policy. Public comment threads require a
**channel** whose target is `reddit:r/{subreddit}` (room id matches `r/{subreddit}` on inbound
messages).

Answers are posted once each part is final (no streaming edits of public comments), as a reply to
the comment or message that asked. Inbox state is saved to `<workspace>/bot-state/reddit/<account>.json`:
the first run sets the existing unread aside, and later runs deliver what arrived while they were
down. Items the bot skips (its own, deleted, unknown kinds) are marked read too, and with
`markRead: false` each item is delivered once.

### Schema Metadata

The configuration schema carries these `.meta()` annotations for the config UI:

- `RedditServiceConfigSchema` — `{ label: "Reddit", description: "Reddit accounts for bot messaging and research tools" }`
- `accounts` — `{ label: "Accounts", description: "Reddit accounts, keyed by the service name bots address them by" }`
- `accounts.<name>.accessToken` — `secret({ description: "OAuth access token (Bearer)" })` (marked secret and sensitive)
- `accounts.<name>.refreshToken` — `secret({ description: "OAuth refresh token" })` (marked secret and sensitive)
- `accounts.<name>.clientId` — `{ description: "Reddit app client ID" }`
- `accounts.<name>.clientSecret` — `secret({ description: "Reddit app client secret" })` (marked secret and sensitive)
- `accounts.<name>.oauthBaseUrl` — `{ advanced: true, description: "Reddit OAuth API base URL" }`
- `accounts.<name>.tokenUrl` — `{ advanced: true, description: "OAuth token endpoint" }`
- `accounts.<name>.userAgent` — `{ advanced: true, description: "User-Agent sent with Reddit API requests (Reddit requires a descriptive UA)" }`
- `accounts.<name>.pollIntervalMs` — `{ advanced: true, description: "How often, in milliseconds, to poll the inbox for new messages and comment replies" }`
- `accounts.<name>.maxMessageLength` — `{ advanced: true, description: "Longest single comment or PM the account will send" }`
- `accounts.<name>.markRead` — `{ advanced: true, description: "Mark inbox items as read after delivering them to a bot" }`
- `publicBaseUrl` — `{ advanced: true, description: "Public Reddit base URL used by research tools (search, latest posts, post retrieval)" }`
- `userAgent` — `{ advanced: true, description: "Default User-Agent for public (unauthenticated) API calls" }`

### Addressing

| Target                 | Meaning                                            |
|------------------------|----------------------------------------------------|
| `reddit:{username}`    | Private message that user                          |
| `reddit:r/{subreddit}` | Subreddit room / channel                           |
| `post:t3_…`            | Internal conversation id for a comment thread      |
| `pm:…`                 | Internal conversation id for a private message     |

### Transport behavior

- The provider polls `/message/unread` every `pollIntervalMs` for new inbox items. On startup it
  seeds the inbox by consuming current unread items without delivering them, so reconnect does not
  replay the whole inbox.
- Private messages (kind `t4` or `was_comment: false`) are delivered as `direct: true`,
  `addressed: true` conversations under `pm:{author}`.
- Comment replies and username mentions (kind `t1` or `was_comment: true`) are delivered as
  `direct: false`, `addressed: true` conversations under `post:{t3_id}` with `roomId: r/{subreddit}`.
- The bot's own `u/{username}` mention is stripped from inbound comment text, and remaining
  whitespace is collapsed.
- First traffic from a subreddit reports it to the bot service as an observed channel
  (`via: "observed"`, `joined: true`). Observed channels never trigger an automatic join.
- After delivery, inbox items are marked as read via `/api/read_message` when `markRead` is `true`
  (the default).
- ConversationStream's working placeholder (matching `***…⏳***`) is held locally and never posted.
  The first real text becomes a comment or PM; further updates use Reddit's edit API
  (`/api/editusertext`) when possible, falling back to posting a new reply if the edit fails.
- Outbound messages to `pm:{user}` are sent via `/api/compose` (or `/api/comment` when replying to
  an existing `t4_` or `t1_` thing). Messages to `post:{id}` are sent as comments via
  `/api/comment`. Messages to `sub:{name}` are submitted as self-posts via `/api/submit`.

### OAuth token handling

When a `refreshToken` is configured with `clientId` and `clientSecret`, the provider refreshes the
access token automatically. The token is refreshed when it is within 30 seconds of expiry. The
refresh request is a POST to `tokenUrl` with HTTP Basic authentication (`clientId:clientSecret`) and
`grant_type=refresh_token`. When only an `accessToken` is configured (no `refreshToken`), it is used
as-is without refresh.

## Chat Commands

| Command             | Description                                |
|---------------------|--------------------------------------------|
| `/connect reddit`   | Connects a Reddit account for bot messaging |

The command is also available as `/reddit connect`.

```text
/connect reddit [accessToken] [refreshToken] [clientId] [clientSecret] [--name=reddit] [--save=workspace]
```

- Positionals are all optional. When run interactively without credentials, the command prompts with
  masked inputs for the access token, refresh token, client ID, and client secret (the latter two
  only when a refresh token is provided).
- `--name` names the account it is saved under (default `reddit`).
- `--save` chooses the config layer the account is written to: `global` (user configuration) or
  `workspace` (workspace configuration), default `workspace`.
- The access token, refresh token and client secret are saved in the vault (category `reddit`, keys
  `<name>.accessToken`, `<name>.refreshToken`, `<name>.clientSecret`) and the account holds
  `{ source: vault, ... }` references to them; the client ID is stored as-is. The vault must be unlocked.
  Credentials typed as positionals stay in the chat history; the masked prompts don't.
- Credentials are merged into an existing account, preserving any other fields it already has.
- Requires an OAuth access token, or a refresh token plus client ID and client secret. Without
  either, the command throws a `CommandFailedError`.

## Tools

These use the public JSON API and do not require a configured account:

| Tool                     | Display Name          | Description                                                                                 |
|--------------------------|-----------------------|---------------------------------------------------------------------------------------------|
| `reddit_searchSubreddit` | Reddit/searchSubreddit | Search posts in a specific subreddit. Returns structured JSON with search results.         |
| `reddit_retrievePost`    | Reddit/retrievePost   | Retrieve a Reddit post's content and comments by URL.                                       |
| `reddit_getLatestPosts`  | Reddit/getLatestPosts | Get the latest posts from a subreddit. Returns newest posts in chronological order.         |

### reddit_searchSubreddit

| Parameter   | Type     | Description                                       |
|-------------|----------|---------------------------------------------------|
| `subreddit` | `string` | Subreddit name (without r/ prefix)                |
| `query`     | `string` | Search query                                      |
| `limit`     | `number` | Number of results (1-100, default: 25)            |
| `sort`      | `enum`   | `relevance` \| `hot` \| `top` \| `new` \| `comments` (default: `relevance`) |
| `t`         | `enum`   | `hour` \| `day` \| `week` \| `month` \| `year` \| `all` — time period for top/hot sorting |
| `after`     | `string` | Fullname of a thing for pagination                |
| `before`    | `string` | Fullname of a thing for pagination                |

**Throws** `ToolCallError` if `subreddit` or `query` is empty.

### reddit_retrievePost

| Parameter | Type     | Description                                                               |
|-----------|----------|---------------------------------------------------------------------------|
| `postUrl` | `string` | Reddit post URL (e.g., `https://www.reddit.com/r/subreddit/comments/id/title/`) |

Only `https://` URLs on `reddit.com` or a subdomain are accepted; other hosts are refused with an error. Only the URL's path is requested, against the configured `publicBaseUrl`.

**Throws** `ToolCallError` if `postUrl` is empty.

### reddit_getLatestPosts

| Parameter   | Type     | Description                               |
|-------------|----------|-------------------------------------------|
| `subreddit` | `string` | Subreddit name (without r/ prefix)        |
| `limit`     | `number` | Number of posts (1-100, default: 25)      |
| `after`     | `string` | Fullname of a thing for pagination        |
| `before`    | `string` | Fullname of a thing for pagination        |

**Throws** `ToolCallError` if `subreddit` is empty.

## Scripting Functions

The plugin registers three native scripting functions with `ScriptingService`:

| Function          | Parameters                       | Description                                                                 |
|-------------------|----------------------------------|-----------------------------------------------------------------------------|
| `searchSubreddit` | `"subreddit"`, `"query"`         | Searches a subreddit; returns `JSON.stringify(result.data.children)`        |
| `getRedditPost`   | `"url"`                          | Retrieves a post by URL; returns `JSON.stringify(result)` (full response)  |
| `getLatestPosts`  | `"subreddit"`                    | Gets latest posts; returns `JSON.stringify(result.data.children)`          |

All parameters are passed as string literals. Each function resolves `RedditService` from the agent
and delegates to the corresponding service method, returning a JSON-stringified result.

## License

MIT License — see LICENSE file for details.

---

## Developer Reference

### RedditService

Connects configured Reddit accounts and registers each one with `BotService` under its account
name. Disconnects and deregisters them on shutdown. Also exposes public research helpers (search,
latest, retrieve) used by chat tools and scripting functions.

| Method                                                       | Description                                                                                          |
|--------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| `getAvailableAccounts()`                                     | Names of the connected accounts                                                                      |
| `getProvider(name)`                                          | The provider for an account                                                                          |
| `reconfigure(options)`                                       | Connects new accounts, stops removed ones, and reconnects accounts whose config changed, registering each with `BotService` |
| `stop()`                                                     | Unregisters and stops every connected account                                                        |
| `searchSubreddit(subreddit, query, opts?)`                   | Searches a subreddit via the public JSON API; returns validated `RedditListingResponseSchema` output |
| `retrievePost(postUrl)`                                      | Retrieves a post's content and comments by URL; returns parsed JSON without schema validation        |
| `getLatestPosts(subreddit, opts?)`                           | Gets the latest posts from a subreddit via the public JSON API; returns validated `RedditListingResponseSchema` output |

`reconfigure` throws a `ConfigurationError` when accounts are configured but the
`@tokenring-ai/bot` plugin is not installed — there would be nothing to connect them to. With no
accounts configured, `BotService` is not required (the research tools still work).

### RedditMessagingProvider

Implements `MessagingProvider` from `@tokenring-ai/bot` for one Reddit account:

- `maxMessageLength` is taken from the account config (default `10000`)
- `start()` looks up the account identity via `/api/v1/me`, seeds the inbox, and starts polling on an interval
- `stop()` clears all handlers, the poll timer, and pending message state
- `resolveConversation` passes `pm:` / `post:` / `sub:` prefixed ids through unchanged, resolves `r/{sub}` to `sub:{sub}`, and resolves bare usernames to `pm:{username}`
- `sendMessage` holds working placeholders locally (returning a `pending:` id) and posts real text as comments, PMs, or self-posts depending on the conversation type
- `updateMessage` flushes pending placeholders to a real post when real text arrives, or edits an existing comment in place (falling back to a new reply if the edit fails)
- inbound PMs are marked `direct: true`, `addressed: true`; inbound comments are marked `direct: false`, `addressed: true`
- the bot's own `u/{username}` mention is stripped from inbound comment text
- `onMembershipChange` reports first traffic from a subreddit as `via: "observed"`, `joined: true`

### Plugin lifecycle

| Field          | Value                                                                                  |
|----------------|----------------------------------------------------------------------------------------|
| `name`         | `@tokenring-ai/reddit`                                                                 |
| `displayName`  | `Reddit Integration`                                                                   |
| `version`      | `0.2.0`                                                                                |
| `description`  | `Reddit transport for TokenRing bots, plus research tools.`                            |
| `configSchema` | `z.object({ reddit: RedditServiceConfigSchema.prefault({ accounts: {} }) })`          |

- `install` — registers `RedditService`; waits for `AgentCommandService` to register the `connect reddit` command; waits for `ChatService` to register the three research tools; waits for `ScriptingService` to register the three scripting functions.
- `reconfigure` — resolves every account's `accessToken`, `refreshToken`, and `clientSecret` secrets via `resolveSecret`, validates that each account has either an access token or a refresh-token-plus-credentials combination, and hands the resolved accounts to `RedditService.reconfigure`.

### Package Structure

```text
plugin/reddit/
├── index.ts                    # Main exports
├── plugin.ts                   # Plugin definition for TokenRing integration
├── RedditService.ts            # Connects accounts, registers them with BotService, provides research helpers
├── RedditMessagingProvider.ts  # The Reddit transport
├── commands.ts                 # Command exports
├── commands/
│   └── connect/reddit.ts       # /connect reddit command
├── tools.ts                    # Tool exports
├── tools/
│   ├── searchSubreddit.ts      # reddit_searchSubreddit tool
│   ├── retrievePost.ts         # reddit_retrievePost tool
│   └── getLatestPosts.ts       # reddit_getLatestPosts tool
├── schema.ts                   # Configuration and API response schemas
├── test/
│   ├── configuration.test.ts           # Schema tests
│   ├── RedditMessagingProvider.test.ts # Transport provider tests
│   └── RedditService.integration.test.ts # Service, tools, and plugin tests
└── LICENSE                     # MIT License
```

### Dependencies

| Package                   | Description                                          |
|---------------------------|------------------------------------------------------|
| `@tokenring-ai/app`       | Application framework, plugin types, service types   |
| `@tokenring-ai/agent`     | Agent commands, `AgentCommandService`                |
| `@tokenring-ai/bot`       | Bot service and `MessagingProvider` contract         |
| `@tokenring-ai/chat`      | Tool registration, tool schema types                 |
| `@tokenring-ai/scripting` | `ScriptingService` for native function registration  |
| `@tokenring-ai/secrets`   | `secret()` schema and `resolveSecret` resolution     |
| `@tokenring-ai/utility`   | `KeyedRegistry`, `HTTPRetriever`                     |
| `zod`                     | Configuration schema validation                      |

### Testing

```bash
bun test
bun run build
```

The suite exercises the configuration schema (multiple accounts, defaults, minimum poll interval,
type inference), the transport provider (`/api/v1/me` lookup, conversation resolution,
working-placeholder handling, PM sending, inbox delivery of comments and PMs), the research helpers
(search, retrieve, latest), tool metadata and execution, HTTP error surfacing, and plugin install.
`bun run build` type-checks the package.
