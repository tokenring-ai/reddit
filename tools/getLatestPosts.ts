import Agent from "@tokenring-ai/agent/Agent";
import {z} from "zod";
import RedditService from "../RedditService.ts";

export const name = "reddit/getLatestPosts";

export async function execute(
  {
    subreddit,
    limit,
    after,
    before,
  }: {
    subreddit?: string;
    limit?: number;
    after?: string;
    before?: string;
  },
  agent: Agent,
): Promise<{ posts?: any }> {
  
  const reddit = agent.requireServiceByType(RedditService);

  if (!subreddit) {
    throw new Error(`[${name}] subreddit is required`);
  }

  agent.infoLine(`[redditLatestPosts] Getting latest posts from r/${subreddit}`);
  const posts = await reddit.getLatestPosts(subreddit, {
    limit,
    after,
    before,
  });
  return {posts};
}

export const description = "Get the latest posts from a subreddit. Returns newest posts in chronological order.";

export const inputSchema = z.object({
  subreddit: z.string().min(1).describe("Subreddit name (without r/ prefix)"),
  limit: z.number().int().positive().max(100).optional().describe("Number of posts (1-100, default: 25)"),
  after: z.string().optional().describe("Fullname of a thing for pagination"),
  before: z.string().optional().describe("Fullname of a thing for pagination"),
});