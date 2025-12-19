# @tokenring-ai/reddit

A comprehensive Reddit integration service for TokenRing AI, providing seamless access to Reddit's JSON API for searching subreddits, retrieving posts, and monitoring latest content.

## Overview

The `@tokenring-ai/reddit` package offers complete Reddit integration through a robust service layer and comprehensive tool suite. It enables AI agents to search Reddit posts, retrieve full post content with comments, and monitor latest posts from subreddits - all with built-in error handling, retry logic, and proper API compliance.

## Installation

```bash
npm install @tokenring-ai/reddit
```

## Package Structure

```
pkg/reddit/
├── RedditService.ts                   # Core Reddit API service
├── index.ts                           # Package exports
├── plugin.ts                          # TokenRing plugin integration
├── package.json                       # Package configuration
├── tools/                             # Built-in tools
│   ├── searchSubreddit.ts             # Subreddit search tool
│   ├── retrievePost.ts                # Post retrieval tool
│   └── getLatestPosts.ts              # Latest posts tool
├── tools.ts                           # Tool exports
└── test/                              # Test suite
    └── RedditService.integration.test.js
```

## Core Components

### RedditService

The primary service for Reddit API interactions with comprehensive error handling:

```typescript
import { default as RedditService } from "@tokenring-ai/reddit";

const reddit = new RedditService({
  baseUrl: "https://www.reddit.com"
});
```

**Configuration:**
```typescript
interface RedditConfig {
  baseUrl?: string;  // Optional custom base URL
}
```

**Core Methods:**

**Subreddit Search:**
- `searchSubreddit(subreddit, query, options)`: Search posts within specific subreddits
- `getLatestPosts(subreddit, options)`: Get latest posts from a subreddit

**Post Retrieval:**
- `retrievePost(postUrl)`: Retrieve full post content and comments

**Search Options:**
```typescript
interface RedditSearchOptions {
  limit?: number;                    // Number of results (1-100, default: 25)
  sort?: 'relevance' | 'hot' | 'top' | 'new' | 'comments';  // Sort order
  t?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';   // Time period
  after?: string;                    // Pagination cursor
  before?: string;                   // Pagination cursor
}
```

**Listing Options:**
```typescript
interface RedditListingOptions {
  limit?: number;                    // Number of posts (1-100, default: 25)
  after?: string;                    // Pagination cursor
  before?: string;                   // Pagination cursor
}
```

### Tool Suite

#### searchSubreddit Tool

Search for posts within specific subreddits:

```typescript
import searchSubreddit from "./tools/searchSubreddit";

// Execute through agent
await searchSubreddit.execute({
  subreddit: "programming",
  query: "javascript async await",
  limit: 10,
  sort: "relevance",
  t: "week"
}, agent);
```

**Input Schema:**
- `subreddit`: Subreddit name (without r/ prefix)
- `query`: Search query string
- `limit`: Number of results (1-100, default: 25)
- `sort`: Sort order (relevance, hot, top, new, comments)
- `t`: Time period for sorting (hour, day, week, month, year, all)
- `after`: Pagination cursor
- `before`: Pagination cursor

#### retrievePost Tool

Retrieve full post content by URL:

```typescript
import retrievePost from "./tools/retrievePost";

await retrievePost.execute({
  postUrl: "https://www.reddit.com/r/programming/comments/abc123/my_post_title/"
}, agent);
```

**Input Schema:**
- `postUrl`: Reddit post URL (must be valid URL)

#### getLatestPosts Tool

Get latest posts from a subreddit:

```typescript
import getLatestPosts from "./tools/getLatestPosts";

await getLatestPosts.execute({
  subreddit: "technology",
  limit: 20
}, agent);
```

**Input Schema:**
- `subreddit`: Subreddit name (without r/ prefix)
- `limit`: Number of posts (1-100, default: 25)
- `after`: Pagination cursor
- `before`: Pagination cursor

## Plugin Integration

The package automatically integrates with TokenRing applications through its plugin system:

```typescript
import redditPlugin from "@tokenring-ai/reddit/plugin";

app.install(redditPlugin);
```

The plugin provides:
1. **Service Registration**: Automatically registers RedditService with the application
2. **Tool Registration**: Registers three tools with the chat service
3. **Scripting Functions**: Registers global functions when @tokenring-ai/scripting is available

### Available Tools

When the plugin is installed, these tools become available through the chat service:

- `/reddit searchSubreddit subreddit=programming query=javascript limit=10`
- `/reddit getLatestPosts subreddit=technology`
- `/reddit retrievePost postUrl=https://www.reddit.com/r/programming/comments/abc123/title/`

### Scripting Functions

When `@tokenring-ai/scripting` is available, these functions are automatically registered:

- `searchSubreddit(subreddit, query)`: Search subreddit posts
- `getRedditPost(url)`: Retrieve post by URL
- `getLatestPosts(subreddit)`: Get latest subreddit posts

**Usage Examples:**
```javascript
// Research workflow
var posts = searchSubreddit("MachineLearning", "transformers");
var analysis = llm("Analyze these Reddit discussions: " + posts);

// Monitor subreddit
var latest = getLatestPosts("technology");
var summary = llm("Summarize today's tech news: " + latest);

// Post retrieval
var post = getRedditPost("https://www.reddit.com/r/programming/comments/abc123/title/");
```

## Configuration

### Service Configuration

```typescript
// Default configuration
const reddit = new RedditService();  // Uses https://www.reddit.com

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

### Error Handling

- **Retry Logic**: Built-in retry using `@tokenring-ai/utility/http/doFetchWithRetry`
- **HTTP Errors**: Proper HTTP error handling and response parsing
- **Rate Limiting**: Respects Reddit's API rate limits
- **Input Validation**: Validates all required parameters

## Usage Examples

### Basic Service Usage

```typescript
import { default as RedditService } from "@tokenring-ai/reddit";

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
const post = await reddit.retrievePost("https://www.reddit.com/r/programming/comments/abc123/my_post/");
```

### Agent Tool Integration

```typescript
// Search subreddit
const searchResults = await agent.executeTool("reddit/searchSubreddit", {
  subreddit: "artificial",
  query: "machine learning trends",
  limit: 15,
  sort: "hot"
});

// Get latest posts
const latestPosts = await agent.executeTool("reddit/getLatestPosts", {
  subreddit: "MachineLearning",
  limit: 10
});

// Retrieve post
const postData = await agent.executeTool("reddit/retrievePost", {
  postUrl: "https://www.reddit.com/r/MachineLearning/comments/xyz789/deep_learning_breakthrough/"
});
```

### Advanced Workflows

**Content Research:**
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
const postAnalysis = await reddit.retrievePost("https://www.reddit.com/r/programming/comments/abc123/trending_topic/");
```

**Monitoring Subreddits:**
```typescript
// Get latest posts with pagination
let after = null;
const posts = await reddit.getLatestPosts("news", {
  limit: 50,
  after: after
});

// Process posts
for (const post of posts.data.children) {
  // Analyze post data
  console.log(post.data.title);
}
```

## API Reference

### RedditService Methods

**searchSubreddit(subreddit, query, options)**
- Searches posts within a specific subreddit
- Returns structured JSON with search results
- Includes metadata and pagination support

**retrievePost(postUrl)**
- Fetches full post content and comments
- Automatically handles .json URL conversion
- Returns complete Reddit post structure

**getLatestPosts(subreddit, options)**
- Gets newest posts in chronological order
- Supports pagination with after/before cursors
- Returns listing with post metadata

### Response Formats

**Search Results:**
```json
{
  "kind": "Listing",
  "data": {
    "children": [...],  // Array of post objects
    "after": "t3_abc123",
    "before": null
  }
}
```

**Post Content:**
```json
{
  "kind": "Listing",
  "data": {
    "children": [
      {
        "kind": "t3",
        "data": { /* post data */ }
      },
      {
        "kind": "t1",
        "data": { /* comment data */ }
      }
    ]
  }
}
```

## Integration Patterns

### Agent Integration

```typescript
// Service automatically available through agent
const reddit = agent.requireServiceByType(RedditService);

// Use in agent methods
async function searchReddit(subreddit: string, query: string) {
  const reddit = this.requireServiceByType(RedditService);
  return await reddit.searchSubreddit(subreddit, query);
}
```

### Chat Service Integration

```typescript
// Tools automatically available in chat interface
/reddit searchSubreddit subreddit=programming query=javascript limit=10
/reddit getLatestPosts subreddit=technology
/reddit retrievePost postUrl=https://reddit.com/r/programming/comments/abc123/title/
```

### Scripting Integration

```typescript
// Functions available in scripting context
searchSubreddit("programming", "async await");
getLatestPosts("MachineLearning");
getRedditPost("https://reddit.com/r/programming/comments/abc123/title/");
```

## Error Handling

The service provides comprehensive error handling:

- **Parameter Validation**: Validates required parameters
- **HTTP Errors**: Handles 4xx, 5xx responses appropriately
- **Rate Limiting**: Implements exponential backoff
- **Network Issues**: Retry logic for temporary failures
- **URL Validation**: Validates Reddit URLs before requests

**Example Error Handling:**
```typescript
try {
  const results = await reddit.searchSubreddit("programming", "javascript");
  console.log(results);
} catch (error) {
  if (error.message.includes("rate limit")) {
    // Handle rate limiting
    await waitForRateLimitReset();
  }
}
```

## Performance Considerations

- **Request Optimization**: Efficient JSON parsing and response handling
- **Rate Limiting**: Respects Reddit's API limits
- **Pagination**: Supports cursor-based pagination for large datasets
- **Caching**: Consider implementing client-side caching for frequently accessed content
- **Batch Operations**: Combine multiple requests when possible

## Dependencies

- **@tokenring-ai/app**: Application framework
- **@tokenring-ai/chat**: Chat service integration
- **@tokenring-ai/agent**: Agent framework
- **@tokenring-ai/utility**: HTTP utilities and retry logic
- **@tokenring-ai/scripting**: Scripting language integration
- **zod**: Schema validation

## Development

### Testing
```bash
npm test
```

### Building
```bash
npm run build
```

### Plugin Development

Create custom Reddit integrations:

```typescript
import { default as RedditService } from "@tokenring-ai/reddit";

class ExtendedRedditService extends RedditService {
  // Add custom methods
  async getUserPosts(username: string) {
    // Custom implementation
  }
}
```

## Testing

The package includes comprehensive integration tests:

```javascript
// Test cases cover:
// - Successful subreddit search
// - Pagination handling
// - Error cases for empty parameters
// - Post content retrieval
// - Latest posts fetching
```

Run tests:
```bash
npm test
```

## Version History

- **0.2.0**: Current version with comprehensive Reddit integration
- Complete subreddit search functionality
- Post retrieval with comment support
- Latest posts monitoring
- Scripting function integration
- Plugin-based automatic registration

## License

MIT

## Related Packages

- **@tokenring-ai/utility**: HTTP utilities and retry logic
- **@tokenring-ai/chat**: Chat service and tool system
- **@tokenring-ai/agent**: Agent framework integration
- **@tokenring-ai/scripting**: Scripting language integration