import { describe, expect, it, mock } from "bun:test";
import type Agent from "@tokenring-ai/agent/Agent";
import ChatService from "@tokenring-ai/chat/ChatService";
import { permissionSlug } from "@tokenring-ai/chat/permissions/permissionIds";
import RedditService from "../RedditService.ts";
import submitPost from "../tools/submitPost.ts";

function fakeAgent(approve: boolean, account: string) {
  const checkToolApproval = mock(async (_options: { safetyLevel: number; permission?: { id: string; summary: string } }) => approve);
  const reddit = {
    resolveAccountName: () => account,
    submitSelfPost: mock(async () => ({ name: "t3_1", url: "https://reddit.com/x" })),
  };
  const agent = {
    requireService: (service: unknown) => (service === ChatService ? { checkToolApproval } : service === RedditService ? reddit : undefined),
    infoMessage: () => {},
  } as unknown as Agent;
  return { agent, checkToolApproval, reddit };
}

const input = { subreddit: "r/test", title: "Hi", text: "Body" };

describe("reddit_submitPost permission", () => {
  it("names a permission for the slugged account, at level 8", async () => {
    const { agent, checkToolApproval } = fakeAgent(true, "My Account.2");
    await submitPost.execute(submitPost.inputSchema.parse(input), agent);
    const options = checkToolApproval.mock.calls[0]?.[0];
    expect(options?.permission).toEqual({ id: `reddit.${permissionSlug("My Account.2")}.post`, summary: "Post on Reddit as My Account.2" });
    expect(options?.safetyLevel).toBe(8);
  });

  it("posts nothing when declined", async () => {
    const { agent, reddit } = fakeAgent(false, "acct");
    await expect(submitPost.execute(submitPost.inputSchema.parse(input), agent)).rejects.toThrow(/did not approve/);
    expect(reddit.submitSelfPost).not.toHaveBeenCalled();
  });
});
