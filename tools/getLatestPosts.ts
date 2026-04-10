import type Agent from "@tokenring-ai/agent/Agent";
import type {TokenRingToolDefinition, TokenRingToolJSONResult,} from "@tokenring-ai/chat/schema";
import {z} from "zod";
import RedditService from "../RedditService.ts";

const name = "reddit_getLatestPosts";
const displayName = "Reddit/getLatestPosts";

async function execute(
  {subreddit, limit, after, before}: z.output<typeof inputSchema>,
  agent: Agent,
): Promise<TokenRingToolJSONResult<{ posts?: any }>> {
  const reddit = agent.requireServiceByType(RedditService);

  if (!subreddit) {
    throw new Error(`[${name}] subreddit is required`);
  }

  agent.infoMessage(`[${name}] Getting latest posts from r/${subreddit}`);
  const posts = await reddit.getLatestPosts(subreddit, {
    limit,
    after,
    before,
  });
  return {
    type: "json",
    data: {posts},
  };
}

const description =
  "Get the latest posts from a subreddit. Returns newest posts in chronological order.";

const inputSchema = z.object({
  subreddit: z.string().min(1).describe("Subreddit name (without r/ prefix)"),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe("Number of posts (1-100, default: 25)"),
  after: z.string().optional().describe("Fullname of a thing for pagination"),
  before: z.string().optional().describe("Fullname of a thing for pagination"),
});

export default {
  name,
  displayName,
  description,
  inputSchema,
  execute,
} satisfies TokenRingToolDefinition<typeof inputSchema>;
