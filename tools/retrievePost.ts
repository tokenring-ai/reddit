import Agent from "@tokenring-ai/agent/Agent";
import {z} from "zod";
import RedditService from "../RedditService.ts";

export const name = "reddit/retrievePost";

export async function execute(
  {
    postUrl,
  }: {
    postUrl?: string;
  },
  agent: Agent,
): Promise<{ post?: any }> {
  
  const reddit = agent.requireServiceByType(RedditService);

  if (!postUrl) {
    throw new Error(`[${name}] postUrl is required`);
  }

  try {
    agent.infoLine(`[redditRetrievePost] Retrieving: ${postUrl}`);
    const post = await reddit.retrievePost(postUrl);
    return {post};
  } catch (e: any) {
    const message = e?.message || String(e);
    throw new Error(`[${name}] ${message}`);
  }
}

export const description = "Retrieve a Reddit post's content and comments by URL.";

export const inputSchema = z.object({
  postUrl: z.string().url().describe("Reddit post URL (e.g., https://www.reddit.com/r/subreddit/comments/id/title/)"),
});