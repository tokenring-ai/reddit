# Reddit Package Documentation

## Overview

The `@tokenring-ai/reddit` package provides seamless integration with Reddit's JSON API for searching subreddit posts and retrieving post content. It is designed specifically for use within the Token Ring AI agent framework, enabling agents to query Reddit programmatically. The package includes a core `RedditService` class for direct API interactions and two agent tools (`searchSubreddit` and `retrievePost`) for easy incorporation into AI workflows.

Key features:
- Search posts within specific subreddits with various sorting and filtering options.
- Retrieve full post content including comments by URL.
- Built-in retry logic for API requests using `doFetchWithRetry`.
- Input validation using Zod schemas for tools.
- Configurable base URL (defaults to reddit.com).

This package acts as a service and tool provider in the larger Token Ring ecosystem, allowing AI agents to access Reddit data without direct HTTP handling.

## Installation/Setup

This package is intended as a dependency in a Token Ring AI project. Install it via npm:

```bash
npm install @tokenring-ai/reddit
```

### Dependencies
Ensure your project has the required peer dependencies:
- `@tokenring-ai/agent` (for service and tool integration)
- `@tokenring-ai/utility` (for `doFetchWithRetry`, if not bundled)

### Setup in Token Ring Agent
1. Import and instantiate `RedditService` in your agent configuration.
2. Register the service with your agent instance.
3. The tools (`reddit/searchSubreddit` and `reddit/retrievePost`) are automatically available via the package export.

Example agent setup (TypeScript):
```typescript
import { Agent } from '@tokenring-ai/agent';
import RedditService from '@tokenring-ai/reddit';

const agent = new Agent({
  services: [new RedditService({ baseUrl: 'https://www.reddit.com' })],
});
```

## Core Components

### RedditService

The `RedditService` is the primary class for interacting with Reddit's JSON API. It implements the `TokenRingService` interface and handles HTTP requests with error handling and retries.

#### Constructor
```typescript
constructor(config: RedditConfig = {})
```
- **Parameters**:
  - `config`: Optional object with `baseUrl` (string, defaults to `'https://www.reddit.com'`).
- **Description**: Initializes the service with the Reddit base URL.

#### searchSubreddit(subreddit: string, query: string, opts: RedditSearchOptions = {}): Promise<any>
- **Parameters**:
  - `subreddit`: Required subreddit name (without r/ prefix).
  - `query`: Required search term (string).
  - `opts`: Optional options including:
    - `limit`: Number of results (default: 25, max: 100).
    - `sort`: Sort order ('relevance', 'hot', 'top', 'new', 'comments').
    - `t`: Time period for sorting ('hour', 'day', 'week', 'month', 'year', 'all').
    - `after`: Fullname for pagination.
    - `before`: Fullname for pagination.
- **Returns**: Promise resolving to Reddit's JSON response with search results.
- **Description**: Searches posts within a specific subreddit using Reddit's search API.

#### retrievePost(postUrl: string): Promise<any>
- **Parameters**:
  - `postUrl`: Required Reddit post URL (string).
- **Returns**: Promise resolving to the post data including comments.
- **Description**: Fetches full post content and comments by URL using Reddit's JSON API.

### Tools

#### searchSubreddit Tool (`reddit/searchSubreddit`)
- **Description**: Searches posts within a subreddit and returns structured results.
- **Input Schema** (Zod):
  ```typescript
  z.object({
    subreddit: z.string().min(1).describe("Subreddit name (without r/ prefix)"),
    query: z.string().min(1).describe("Search query"),
    limit: z.number().int().positive().max(100).optional(),
    sort: z.enum(['relevance', 'hot', 'top', 'new', 'comments']).optional(),
    t: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).optional(),
    after: z.string().optional(),
    before: z.string().optional(),
  })
  ```

#### retrievePost Tool (`reddit/retrievePost`)
- **Description**: Retrieves full post content and comments by URL.
- **Input Schema** (Zod):
  ```typescript
  z.object({
    postUrl: z.string().url().describe("Reddit post URL"),
  })
  ```

## Global Scripting Functions

When `@tokenring-ai/scripting` is available, the reddit package registers native functions:

- **searchSubreddit(subreddit, query)**: Searches posts within a subreddit and returns JSON results.
  ```bash
  /var $posts = searchSubreddit("programming", "javascript")
  /call searchSubreddit("technology", "AI")
  ```

- **getRedditPost(url)**: Retrieves a Reddit post by URL.
  ```bash
  /var $post = getRedditPost("https://www.reddit.com/r/programming/comments/abc123/title/")
  ```

- **getLatestPosts(subreddit)**: Gets the latest posts from a subreddit.
  ```bash
  /var $latest = getLatestPosts("technology")
  /call getLatestPosts("programming")
  ```

These functions integrate with the scripting system:

```bash
# Research workflow
/var $posts = searchSubreddit("MachineLearning", "transformers")
/var $analysis = llm("Analyze these Reddit discussions: $posts")

# Monitor subreddit
/var $latest = getLatestPosts("technology")
/var $summary = llm("Summarize today's tech news from Reddit: $latest")
```

## Usage Examples

### Direct Service Usage
```typescript
import RedditService from '@tokenring-ai/reddit';

const reddit = new RedditService();

async function example() {
  // Search subreddit
  const searchResults = await reddit.searchSubreddit('programming', 'javascript', { 
    limit: 5,
    sort: 'top',
    t: 'week'
  });
  console.log(searchResults.data.children); // Array of posts

  // Get post content
  const postContent = await reddit.retrievePost('https://www.reddit.com/r/programming/comments/abc123/title/');
  console.log(postContent); // Post data with comments
}
```

### Agent Tool Usage
```typescript
// Search posts
const response = await agent.executeTool('reddit/searchSubreddit', {
  subreddit: 'technology',
  query: 'artificial intelligence',
  limit: 10,
  sort: 'hot'
});

// Retrieve specific post
const postResponse = await agent.executeTool('reddit/retrievePost', {
  postUrl: 'https://www.reddit.com/r/technology/comments/xyz789/ai_breakthrough/',
});
```

## Configuration Options

- **baseUrl** (string, optional): Custom Reddit base URL. Defaults to 'https://www.reddit.com'.
- **Request Headers**: Fixed `User-Agent` for compliance: `"TokenRing-Writer/1.0 (https://github.com/tokenring/writer)"`.
- **Retry Logic**: Handled internally by `doFetchWithRetry`.

## API Reference

### Public APIs (RedditService)
- `constructor(config?: { baseUrl?: string })`
- `searchSubreddit(subreddit: string, query: string, opts?: RedditSearchOptions): Promise<any>`
- `retrievePost(postUrl: string): Promise<any>`

### Tools
- `reddit/searchSubreddit`: Search posts within a subreddit
- `reddit/retrievePost`: Retrieve post content by URL

### Exports
- `packageInfo: TokenRingPackage` (includes tools: `{ searchSubreddit, retrievePost }`)
- `RedditService` (default export)

## Dependencies

- **Runtime**:
  - `@tokenring-ai/ai-client@0.1.0`
  - `@tokenring-ai/agent@0.1.0`
  - `zod@^4.0.17`
- **Development**:
  - `vitest@^3.2.4`
  - `@vitest/coverage-v8@^3.2.4`

## Contributing/Notes

- **Testing**: Run tests with `npm test` (uses Vitest). Includes integration tests for service methods.
- **Rate Limiting**: Reddit has API rate limits; respect their usage policies.
- **No Authentication**: Uses Reddit's public JSON API endpoints.
- **License**: MIT.

For more on Token Ring integration, see the framework docs.