import type Agent from "@tokenring-ai/agent/Agent";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import { stripUndefinedKeys } from "@tokenring-ai/utility/object/stripObject";
import { z } from "zod";
import RedditService from "../RedditService.ts";

const name = "reddit_searchSubreddit";
const displayName = "Reddit/searchSubreddit";

async function execute({ subreddit, query, limit, sort, t, after, before }: z.output<typeof inputSchema>, agent: Agent): Promise<TokenRingToolResult> {
  const reddit = agent.requireServiceByType(RedditService);

  if (!subreddit) {
    throw new Error(`[${name}] subreddit is required`);
  }

  if (!query) {
    throw new Error(`[${name}] query is required`);
  }

  agent.infoMessage(`[${name}] Searching r/${subreddit} for: ${query}`);
  const results = await reddit.searchSubreddit(
    subreddit,
    query,
    stripUndefinedKeys({
      limit,
      sort,
      t,
      after,
      before,
    }),
  );
  return JSON.stringify(results);
}

const description = "Search posts in a specific subreddit. Returns structured JSON with search results.";

const inputSchema = z.object({
  subreddit: z.string().min(1).describe("Subreddit name (without r/ prefix)"),
  query: z.string().min(1).describe("Search query"),
  limit: z.number().int().positive().max(100).exactOptional().describe("Number of results (1-100, default: 25)"),
  sort: z.enum(["relevance", "hot", "top", "new", "comments"]).exactOptional().describe("Sort order (default: relevance)"),
  t: z.enum(["hour", "day", "week", "month", "year", "all"]).exactOptional().describe("Time period for top/hot sorting"),
  after: z.string().exactOptional().describe("Fullname of a thing for pagination"),
  before: z.string().exactOptional().describe("Fullname of a thing for pagination"),
});

export default {
  name,
  displayName,
  description,
  inputSchema,
  execute,
} satisfies TokenRingToolDefinition<typeof inputSchema>;
