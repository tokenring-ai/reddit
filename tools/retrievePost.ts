import type Agent from "@tokenring-ai/agent/Agent";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import { z } from "zod";
import RedditService from "../RedditService.ts";

const name = "reddit_retrievePost";
const displayName = "Reddit/retrievePost";

async function execute({ postUrl }: z.output<typeof inputSchema>, agent: Agent): Promise<TokenRingToolResult> {
  const reddit = agent.requireServiceByType(RedditService);

  if (!postUrl) {
    throw new Error(`[${name}] postUrl is required`);
  }

  agent.infoMessage(`[redditRetrievePost] Retrieving: ${postUrl}`);
  const post = await reddit.retrievePost(postUrl);
  return JSON.stringify(post);
}

const description = "Retrieve a Reddit post's content and comments by URL.";

const inputSchema = z.object({
  postUrl: z.string().url().describe("Reddit post URL (e.g., https://www.reddit.com/r/subreddit/comments/id/title/)"),
});

export default {
  name,
  displayName,
  description,
  inputSchema,
  execute,
} satisfies TokenRingToolDefinition<typeof inputSchema>;
