import Agent from "@tokenring-ai/agent/Agent";
import {TokenRingToolDefinition} from "@tokenring-ai/chat/schema";
import {z} from "zod";
import RedditService from "../RedditService.ts";

const name = "reddit_searchSubreddit";
const displayName = "Reddit/searchSubreddit";

async function execute(
  {
    subreddit,
    query,
    limit,
    sort,
    t,
    after,
    before,
  }: z.infer<typeof inputSchema>,
  agent: Agent,
): Promise<{ results?: any }> {
  
  const reddit = agent.requireServiceByType(RedditService);

  if (!subreddit) {
    throw new Error(`[${name}] subreddit is required`);
  }

  if (!query) {
    throw new Error(`[${name}] query is required`);
  }

  agent.infoMessage(`[redditSearch] Searching r/${subreddit} for: ${query}`);
  const results = await reddit.searchSubreddit(subreddit, query, {
    limit,
    sort,
    t,
    after,
    before,
  });
  return {results};
}

const description = "Search posts in a specific subreddit. Returns structured JSON with search results.";

const inputSchema = z.object({
  subreddit: z.string().min(1).describe("Subreddit name (without r/ prefix)"),
  query: z.string().min(1).describe("Search query"),
  limit: z.number().int().positive().max(100).optional().describe("Number of results (1-100, default: 25)"),
  sort: z.enum(['relevance', 'hot', 'top', 'new', 'comments']).optional().describe("Sort order (default: relevance)"),
  t: z.enum(['hour', 'day', 'week', 'month', 'year', 'all']).optional().describe("Time period for top/hot sorting"),
  after: z.string().optional().describe("Fullname of a thing for pagination"),
  before: z.string().optional().describe("Fullname of a thing for pagination"),
});

export default {
  name, displayName, description, inputSchema, execute,
} satisfies TokenRingToolDefinition<typeof inputSchema>;