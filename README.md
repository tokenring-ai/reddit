# @tokenring-ai/reddit

## Overview

A Reddit integration service for TokenRing AI, providing access to Reddit's JSON API for searching subreddits, retrieving posts, and monitoring latest content. This package enables AI agents to interact with Reddit in a structured, type-safe manner.

## Key Features

- **Subreddit Search**: Search posts within specific subreddits with sorting and filtering options
- **Post Retrieval**: Retrieve full post content and comments by URL
- **Latest Posts**: Get newest posts from subreddits with pagination support
- **Type-Safe Configuration**: Zod schema validation for all inputs
- **Plugin Architecture**: Automatic registration with TokenRing applications
- **Scripting Support**: Global functions for programmatic access
- **Chat Tools Integration**: Three tools registered with the chat service

## Installation

```bash
bun install @tokenring-ai/reddit
```

## Plugin Configuration

The plugin uses a nested configuration schema with a base URL option:

```typescript
interface RedditPluginConfig {
  reddit: {
    baseUrl?: string;  // Optional custom base URL (default: https://www.reddit.com)
  };
}
```

**Configuration Example:**

```typescript
// Default configuration
const config = {
  reddit: {
    baseUrl: "https://www.reddit.com"
  }
};

// Custom base URL
const customConfig = {
  reddit: {
    baseUrl: "https://custom.reddit.com"
  }
};
```

## Agent Configuration

This package does not require agent-specific configuration.

## Tools

### reddit_searchSubreddit

Search posts in a specific subreddit. Returns structured JSON with search results.

**Tool Definition:**

```typescript
{
  name: "reddit_searchSubreddit",
  displayName: "Reddit/searchSubreddit",
  description: "Search posts in a specific subreddit. Returns structured JSON with search results.",
  inputSchema: {
    subreddit: z.string().min(1).describe("Subreddit name (without r/ prefix)"),
    query: z.string().min(1).describe("Search query"),
    limit: z.number().int().positive().max(100).optional().describe("Number of results (1-100, default: 25)"),
    sort: z.enum(['relevance', 'hot', 'top', 'new', 'comments']).optional().describe("Sort order (default: relevance)"),
    t: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).optional().describe("Time period for top/hot sorting"),
    after: z.string().optional().describe("Fullname of a thing for pagination"),
    before: z.string().optional().describe("Fullname of a thing for pagination"),
  }
}
```

**Usage Example:**

```typescript
const results = await agent.executeTool("reddit_searchSubreddit", {
  subreddit: "programming",
  query: "javascript async await",
  limit: 10,
  sort: "relevance",
  t: "week"
});
```

### reddit_retrievePost

Retrieve a Reddit post's content and comments by URL.

**Tool Definition:**

```typescript
{
  name: "reddit_retrievePost",
  displayName: "Reddit/retrievePost",
  description: "Retrieve a Reddit post's content and comments by URL.",
  inputSchema: {
    postUrl: z.string().url().describe("Reddit post URL (e.g., https://www.reddit.com/r/subreddit/comments/id/title/)"),
  }
}
```

**Usage Example:**

```typescript
const post = await agent.executeTool("reddit_retrievePost", {
  postUrl: "https://www.reddit.com/r/programming/comments/abc123/my_post/"
});
```

### reddit_getLatestPosts

Get the latest posts from a subreddit. Returns newest posts in chronological order.

**Tool Definition:**

```typescript
{
  name: "reddit_getLatestPosts",
  displayName: "Reddit/getLatestPosts",
  description: "Get the latest posts from a subreddit. Returns newest posts in chronological order.",
  inputSchema: {
    subreddit: z.string().min(1).describe("Subreddit name (without r/ prefix)"),
    limit: z.number().int().positive().max(100).optional().describe("Number of posts (1-100, default: 25)"),
    after: z.string().optional().describe("Fullname of a thing for pagination"),
    before: z.string().optional().describe("Fullname of a thing for pagination"),
  }
}
```

**Usage Example:**

```typescript
const posts = await agent.executeTool("reddit_getLatestPosts", {
  subreddit: "technology",
  limit: 20
});
```

## Services

### RedditService

Core service for Reddit API interactions. This service implements `TokenRingService` and extends the `HttpService` base class to handle HTTP requests with retry logic and automatic JSON parsing.

**Service Definition:**

```typescript
class RedditService extends HttpService implements TokenRingService {
  readonly name = "RedditService";
  description = "Service for searching Reddit posts and retrieving content";
  
  constructor(config: ParsedRedditConfig);
  async searchSubreddit(subreddit: string, query: string, opts?: RedditSearchOptions): Promise<any>;
  async retrievePost(postUrl: string): Promise<any>;
  async getLatestPosts(subreddit: string, opts?: RedditListingOptions): Promise<any>;
}
```

**Configuration Interface:**

```typescript
interface ParsedRedditConfig {
  baseUrl: string;
}
```

**Service Methods:**

#### searchSubreddit

Search posts within a specific subreddit.

```typescript
async searchSubreddit(subreddit: string, query: string, opts?: RedditSearchOptions): Promise<any>
```

**Parameters:**
- `subreddit` (string): Subreddit name without the r/ prefix
- `query` (string): Search query string
- `opts` (RedditSearchOptions, optional): Additional options for the search

**Returns**: Promise containing the search results

**Example:**

```typescript
const results = await reddit.searchSubreddit("programming", "typescript", {
  limit: 10,
  sort: "relevance",
  t: "week"
});
```

#### retrievePost

Retrieve a Reddit post by URL.

```typescript
async retrievePost(postUrl: string): Promise<any>
```

**Parameters:**
- `postUrl` (string): Full URL to the Reddit post

**Returns**: Promise containing the post data and comments

**Example:**

```typescript
const post = await reddit.retrievePost("https://www.reddit.com/r/programming/comments/abc123/my_post/");
```

#### getLatestPosts

Get the latest posts from a subreddit.

```typescript
async getLatestPosts(subreddit: string, opts?: RedditListingOptions): Promise<any>
```

**Parameters:**
- `subreddit` (string): Subreddit name without the r/ prefix
- `opts` (RedditListingOptions, optional): Additional options for the request

**Returns**: Promise containing the latest posts

**Example:**

```typescript
const posts = await reddit.getLatestPosts("technology", {
  limit: 20
});
```

**Search Options:**

```typescript
interface RedditSearchOptions {
  limit?: number;                                     // Number of results (1-100, default: 25)
  sort?: 'relevance' | 'hot' | 'top' | 'new' | 'comments';  // Sort order (default: relevance)
  t?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';   // Time period
  after?: string;                                     // Pagination cursor
  before?: string;                                    // Pagination cursor
}
```

**Listing Options:**

```typescript
interface RedditListingOptions {
  limit?: number;   // Number of posts (1-100, default: 25)
  after?: string;   // Pagination cursor
  before?: string;  // Pagination cursor
}
```

## Scripting Integration

The following functions are available in the scripting context:

### searchSubreddit(subreddit, query)

Search posts in a subreddit.

```typescript
// Available globally in scripting context
const results = await searchSubreddit("programming", "javascript");
```

### getRedditPost(url)

Retrieve a Reddit post by URL.

```typescript
// Available globally in scripting context
const post = await getRedditPost("https://www.reddit.com/r/programming/comments/abc123/post/");
```

### getLatestPosts(subreddit)

Get latest posts from a subreddit.

```typescript
// Available globally in scripting context
const posts = await getLatestPosts("MachineLearning");
```

## Usage Examples

### Basic Service Usage

```typescript
import RedditService from "@tokenring-ai/reddit";

const reddit = new RedditService({
  baseUrl: "https://www.reddit.com"
});

// Search posts in subreddit
const results = await reddit.searchSubreddit("programming", "javascript", {
  limit: 10,
  sort: "relevance",
  t: "week"
});

// Get latest posts
const latest = await reddit.getLatestPosts("technology", {
  limit: 20
});

// Retrieve specific post
const post = await reddit.retrievePost(
  "https://www.reddit.com/r/programming/comments/abc123/my_post/"
);
```

### Agent Tool Integration

```typescript
// Search subreddit
const searchResults = await agent.executeTool("reddit_searchSubreddit", {
  subreddit: "artificial",
  query: "machine learning trends",
  limit: 15,
  sort: "hot"
});

// Get latest posts
const latestPosts = await agent.executeTool("reddit_getLatestPosts", {
  subreddit: "MachineLearning",
  limit: 10
});

// Retrieve post
const postData = await agent.executeTool("reddit_retrievePost", {
  postUrl: "https://www.reddit.com/r/MachineLearning/comments/xyz789/deep_learning_breakthrough/"
});
```

### Scripting Integration

```typescript
// Functions available in scripting context
const searchResults = await searchSubreddit("programming", "async await");
const latestPosts = await getLatestPosts("MachineLearning");
const post = await getRedditPost("https://reddit.com/r/programming/comments/abc123/title/");
```

### Content Research Workflow

```typescript
// Search for relevant discussions
const discussions = await reddit.searchSubreddit("programming", "best practices", {
  limit: 20,
  sort: "top",
  t: "month"
});

// Get latest posts for trending topics
const trending = await reddit.getLatestPosts("technology", {
  limit: 25
});

// Analyze specific posts
const postAnalysis = await reddit.retrievePost(
  "https://www.reddit.com/r/programming/comments/abc123/trending_topic/"
);
```

### Monitoring Subreddits with Pagination

```typescript
const reddit = new RedditService(RedditConfigSchema.parse({}));

// Get latest posts with pagination
const posts = await reddit.getLatestPosts("news", {
  limit: 50,
  after: "t3_abc123"  // Use after cursor from previous response
});

// Process posts
for (const post of posts.data.children) {
  console.log(post.data.title);
}
```

## Configuration

### Service Configuration

```typescript
// Default configuration (uses https://www.reddit.com)
const reddit = new RedditService({
  baseUrl: "https://www.reddit.com"
});

// Custom base URL
const customReddit = new RedditService({
  baseUrl: "https://custom.reddit.com"
});
```

### Request Headers

The service automatically sets a compliant User-Agent:

```
User-Agent: TokenRing-Writer/1.0 (https://github.com/tokenring/writer)
```

## Integration

### Agent System Integration

The plugin automatically integrates with the agent system by:

1. Waiting for the `ScriptingService` to register custom functions
2. Registering three custom functions: `searchSubreddit`, `getRedditPost`, `getLatestPosts`
3. Waiting for the `ChatService` to register chat tools
4. Adding three tools to the chat service

### Service Registration

The plugin registers the `RedditService` with the application:

```typescript
app.addServices(new RedditService(config.reddit));
```

### Chat Service Integration

The plugin waits for the `ChatService` and registers its tools:

```typescript
app.waitForService(ChatService, chatService =>
  chatService.addTools(tools)
);
```

### Scripting Service Integration

The plugin registers functions with the `ScriptingService`:

```typescript
scriptingService.registerFunction("searchSubreddit", {
  type: 'native',
  params: ['subreddit', 'query'],
  async execute(this: ScriptingThis, subreddit: string, query: string): Promise<string> {
    const result = await this.agent.requireServiceByType(RedditService).searchSubreddit(subreddit, query);
    return JSON.stringify(result.data.children);
  }
});
```

## RPC Endpoints

This package does not define any RPC endpoints.

## State Management

This package does not implement state management.

## Development

### Testing

```bash
bun run test
bun run test:watch
bun run test:coverage
```

### Build

```bash
bun run build
```

### Package Structure

```
pkg/reddit/
├── RedditService.ts              # Core Reddit API service
├── index.ts                      # Package exports
├── plugin.ts                     # TokenRing plugin integration
├── schema.ts                     # Zod configuration schema
├── tools.ts                      # Tool exports
├── tools/
│   ├── searchSubreddit.ts        # Subreddit search tool
│   ├── retrievePost.ts           # Post retrieval tool
│   └── getLatestPosts.ts         # Latest posts tool
├── test/
│   └── RedditService.integration.test.ts  # Integration tests
├── package.json                  # Package configuration
├── vitest.config.ts              # Vitest configuration
├── LICENSE                       # MIT license
└── .gitignore                    # Git ignore patterns
```

### Dependencies

**Runtime Dependencies:**
- `@tokenring-ai/app`: TokenRing application framework
- `@tokenring-ai/chat`: Chat service and tool system
- `@tokenring-ai/agent`: Agent framework
- `@tokenring-ai/utility`: Shared utilities including HTTP service
- `@tokenring-ai/scripting`: Scripting service (used by plugin)
- `zod`: Schema validation

**Development Dependencies:**
- `vitest`: Test runner
- `@vitest/coverage-v8`: Test coverage reporting
- `typescript`: TypeScript compiler (uses root tsconfig.json)

### TypeScript Configuration

This package uses the root-level `tsconfig.json` for type checking. To verify types:

```bash
bun run build
```

### Contribution Guidelines

- Follow existing code style and patterns
- Add unit tests for new functionality
- Update documentation for new features
- Ensure all changes work with TokenRing agent framework
- Maintain consistency with other package documentation patterns

## License

MIT License - see [LICENSE](./LICENSE) file for details.
