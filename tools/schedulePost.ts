import { randomUUID } from "node:crypto";
import type Agent from "@tokenring-ai/agent/Agent";
import { permissionSlug } from "@tokenring-ai/chat";
import ChatService from "@tokenring-ai/chat/ChatService";
import type { TokenRingToolDefinition, TokenRingToolResult } from "@tokenring-ai/chat/schema";
import { ToolCallError } from "@tokenring-ai/chat/util/tokenRingTool";
import SchedulerService from "@tokenring-ai/scheduler/SchedulerService";
import { parseAt } from "@tokenring-ai/scheduler/utility/getNextRunTime";
import intelligentTruncate from "@tokenring-ai/utility/string/intelligentTruncate";
import { z } from "zod";
import RedditService from "../RedditService.ts";
import { normalizeSubreddit, TITLE_MAX } from "./submitPost.ts";

const name = "reddit_schedulePost";
const displayName = "Reddit/schedulePost";
const description =
  "Schedule a text (self) post to a subreddit from a connected Reddit account to be published later, at a fixed time, without anyone approving it then. " +
  "The exact title and text are fixed now (no model runs at post time). The post is public and cannot be unsent, so scheduling always goes through approval, " +
  "and it shares the permission of reddit_submitPost: allowing one allows the other. To post now, use reddit_submitPost.";

/** Same as reddit_submitPost: the post reaches people, and the later run is unattended. */
const SAFETY_LEVEL = 8;

const inputSchema = z.object({
  subreddit: z.string().min(1).describe("Subreddit to post in (with or without the r/ prefix)"),
  title: z.string().min(1).describe("Post title"),
  text: z.string().min(1).describe("Self-post body, exactly as it will be published"),
  at: z
    .string()
    .min(1)
    .describe("When to publish, as an ISO 8601 date and time with a UTC offset, for example 2026-11-20T09:00:00-05:00. Must be in the future."),
  account: z.string().min(1).exactOptional().describe("Connected Reddit account name. Required when more than one account is connected."),
});

async function execute({ subreddit, title, text, at, account }: z.output<typeof inputSchema>, agent: Agent): Promise<TokenRingToolResult> {
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

  const time = parseAt(at);
  if (time === null) throw new ToolCallError(name, `"${at}" is not a date and time with a UTC offset. Use ISO 8601, for example 2026-11-20T09:00:00-05:00.`);
  if (time <= Date.now()) throw new ToolCallError(name, "The post time must be in the future.");
  const when = new Date(time).toISOString();

  const scheduler = agent.requireService(SchedulerService);

  const approved = await agent.requireService(ChatService).checkToolApproval(
    {
      toolName: name,
      message: `Schedule a post to r/${sr} as ${accountName} for ${when}?`,
      detailedDescription: [
        `At ${when} the connected Reddit account "${accountName}" publishes a self post to r/${sr}, with nobody asked again. It is public and cannot be unsent.`,
        "",
        `Title: ${postTitle}`,
        "",
        "Text:",
        intelligentTruncate(body, { maxLength: 2_000 }),
      ].join("\n"),
      safetyLevel: SAFETY_LEVEL,
      default: false,
      // The same permission as reddit_submitPost: one "Always allow" covers scheduling and the later run.
      permission: { id: `reddit.${permissionSlug(accountName)}.post`, summary: `Post on Reddit as ${accountName}` },
    },
    agent,
  );
  if (!approved) throw new ToolCallError(name, "User did not approve scheduling the post");

  const scheduleName = `social-reddit-${randomUUID().slice(0, 8)}`;
  scheduler.addSchedule(scheduleName, {
    at: when,
    action: {
      kind: "tool",
      agentType: agent.config.agentType,
      tool: "reddit_submitPost",
      input: { subreddit: sr, title: postTitle, text: body, account: accountName },
    },
  });

  return {
    message: `**Reddit** Scheduled a post to r/${sr} as ${accountName} for ${when}`,
    result: `Scheduled ${scheduleName}: post to r/${sr} as ${accountName} at ${when}. It publishes without asking again, only if the permission reddit.${permissionSlug(accountName)}.post is granted at that time.`,
  };
}

export default {
  name,
  displayName,
  description,
  inputSchema,
  execute,
} satisfies TokenRingToolDefinition<typeof inputSchema>;
