# @tokenring-ai/reddit

## Overview
A Reddit integration service for TokenRing AI, providing access to Reddit's JSON API for searching subreddits, retrieving posts, and monitoring latest content. This package enables AI agents to interact with Reddit in a structured, type-safe manner.

## Features
- **Subreddit Search**: Search posts within specific subreddits with sorting and filtering
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

## Core Components/API

### RedditService

The primary service for Reddit API interactions.

#### Constructor
```typescript
new RedditService(config: RedditConfig)
```

**Configuration:**
```typescript
interface RedditConfig {
  baseUrl?: string;  // Optional custom base URL (default: https://www.reddit.com)
}
```

#### Core Methods

**searchSubreddit:**
```typescript
async searchSubreddit(subreddit: string, query: string, opts?: RedditSearchOptions): Promise<any>
```
Search posts within a specific subreddit.

**retrievePost:**
```typescript
async retrievePost(postUrl: string): Promise<any>
```
Retrieve full post content and comments by URL.

**getLatestPosts:**
```typescript
async getLatestPosts(subreddit: string, opts?: RedditListingOptions): Promise<any>
```
Get latest posts from a subreddit.

#### Search Options
```typescript
interface RedditSearchOptions {
  limit?: number;                                     // Number of results (1-100, default: 25)
  sort?: 'relevance' | 'hot' | 'top' | 'new' | 'comments';  // Sort order (default: relevance)
  t?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';   // Time period
  after?: string;                                     // Pagination cursor
  before?: string;                                    // Pagination cursor
}
```

#### Listing Options
```typescript
interface RedditListingOptions {
  limit?: number;        // Number of posts (1-100, default: 25)
  after?: string;        // Pagination cursor
  before?: string;       // Pagination cursor
}
```

### Tools

#### searchSubreddit
```typescript
{
  name: "reddit_searchSubreddit",
  description: "Search posts in a specific subreddit. Returns structured JSON with search results.",
  inputSchema: {
    subreddit: z.string().min(1),
    query: z.string().min(1),
    limit: z.number().int().positive().max(100).optional(),
    sort: z.enum(['relevance', 'hot', 'top', 'new', 'comments']).optional(),
    t: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).optional(),
    after: z.string().optional(),
    before: z.string().optional(),
  }
}
```

#### retrievePost
```typescript
{
  name: "reddit_retrievePost",
  description: "Retrieve a Reddit post's content and comments by URL.",
  inputSchema: {
    postUrl: z.string().url(),
  }
}
```

#### getLatestPosts
```typescript
{
  name: "reddit_getLatestPosts",
  description: "Get the latest posts from a subreddit. Returns newest posts in chronological order.",
  inputSchema: {
    subreddit: z.string().min(1),
    limit: z.number().int().positive().max(100).optional(),
    after: z.string().optional(),
    before: z.string().optional(),
  }
}
```

## Plugin Configuration

The plugin has an empty configuration schema:

```typescript
const packageConfigSchema = z.object({});
```

## Usage Examples

### Basic Service Usage

```typescript
import RedditService from "@tokenring-ai/reddit";

const reddit = new RedditService();

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
searchSubreddit("programming", "async await");
getLatestPosts("MachineLearning");
getRedditPost("https://reddit.com/r/programming/comments/abc123/title/");
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
const reddit = new RedditService();

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
const reddit = new RedditService();

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

## Services

### RedditService

```typescript
class RedditService extends HttpService implements TokenRingService {
  name = "RedditService";
  description = "Service for searching Reddit posts and retrieving content";

  async searchSubreddit(subreddit: string, query: string, opts?: RedditSearchOptions): Promise<any>;
  async retrievePost(postUrl: string): Promise<any>;
  async getLatestPosts(subreddit: string, opts?: RedditListingOptions): Promise<any>;
}
```

## Development

### Testing

```bash
bun run test
bun run test:coverage
```

### Package Structure

```
pkg/reddit/
├── RedditService.ts              # Core Reddit API service
├── index.ts                      # Package exports
├── plugin.ts                     # TokenRing plugin integration
├── package.json                  # Package configuration
├── tools/                        # Chat tools
│   ├── searchSubreddit.ts        # Subreddit search tool
│   ├── retrievePost.ts           # Post retrieval tool
│   └── getLatestPosts.ts         # Latest posts tool
├── tools.ts                      # Tool exports
├── LICENSE                       # MIT license
└── test/                         # Test suite
    └── RedditService.integration.test.js
```

### Contribution Guidelines
- Follow existing code style and patterns
- Add unit tests for new functionality
- Update documentation for new features
- Ensure all changes work with TokenRing agent framework

## License

MIT License - see [LICENSE](./LICENSE) file for details.
