import type Agent from "@tokenring-ai/agent/Agent";
import { permissionSlug } from "@tokenring-ai/chat";
import ChatService from "@tokenring-ai/chat/ChatService";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import { ToolCallError } from "@tokenring-ai/chat/util/tokenRingTool";
import intelligentTruncate from "@tokenring-ai/utility/string/intelligentTruncate";
import { z } from "zod";
import RedditService from "../RedditService.ts";

const name = "reddit_submitPost";
const displayName = "Reddit/submitPost";
const description =
  "Publish a text (self) post to a subreddit from a connected Reddit account. The post is public and cannot be unsent, so it always goes through approval.";

/** A public post (approval standard: reaches people). */
const SAFETY_LEVEL = 8;
export const TITLE_MAX = 300;

const inputSchema = z.object({
  subreddit: z.string().min(1).describe("Subreddit to post in (with or without the r/ prefix)"),
  title: z.string().min(1).describe("Post title"),
  text: z.string().min(1).describe("Self-post body"),
  account: z.string().min(1).exactOptional().describe("Connected Reddit account name. Required when more than one account is connected."),
});

async function execute({ subreddit, title, text, account }: z.output<typeof inputSchema>, agent: Agent): Promise<TokenRingToolResult> {
  const sr = normalizeSubreddit(subreddit);
  const postTitle = title.trim();
  const body = text.trim();
  if (!sr) throw new ToolCallError(name, "subreddit is required");
  if (!postTitle) throw new ToolCallError(name, "title is required");
  if (!body) throw new ToolCallError(name, "text is required");
  if (postTitle.length > TITLE_MAX) throw new ToolCallError(name, `title must be ${TITLE_MAX} characters or fewer`);

  const reddit = agent.requireService(RedditService);
  let accountName: string;
  try {
    accountName = reddit.resolveAccountName(account);
  } catch (error) {
    throw new ToolCallError(name, error instanceof Error ? error.message : String(error), { cause: error });
  }

  const approved = await agent.requireService(ChatService).checkToolApproval(
    {
      toolName: name,
      message: `Post to r/${sr} as ${accountName}?`,
      detailedDescription: [
        `Publish a self post to r/${sr} from the connected Reddit account "${accountName}". It is public and cannot be unsent.`,
        "",
        `Title: ${postTitle}`,
        "",
        "Text:",
        intelligentTruncate(body, { maxLength: 2_000 }),
      ].join("\n"),
      safetyLevel: SAFETY_LEVEL,
      default: false,
      permission: { id: `reddit.${permissionSlug(accountName)}.post`, summary: `Post on Reddit as ${accountName}` },
    },
    agent,
  );

  if (!approved) throw new ToolCallError(name, "User did not approve posting");

  agent.infoMessage(`[${name}] Posting to r/${sr} as ${accountName}`);
  const post = await reddit.submitSelfPost(sr, postTitle, body, accountName);

  return {
    message: `**Reddit** Posted to r/${sr}`,
    result: `Posted to r/${sr} as ${accountName}: ${post.name}${post.url ? `\n${post.url}` : ""}`,
  };
}

export function normalizeSubreddit(value: string): string {
  return value
    .trim()
    .replace(/^\/?r\//i, "")
    .trim();
}

export default {
  name,
  displayName,
  description,
  inputSchema,
  execute,
} satisfies TokenRingToolDefinition<typeof inputSchema>;
