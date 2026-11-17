import { describe, expect, it, mock } from "bun:test";
import type TokenRingApp from "@tokenring-ai/app";
import RedditService from "../RedditService.ts";
import redditRPC from "../rpc/reddit.ts";
import RedditRpcSchema from "../rpc/schema.ts";

function fakeApp() {
  const submitSelfPost = mock(async (_sr: string, _title: string, _text: string, _account?: string) => ({
    id: "abc",
    name: "t3_abc",
    url: "https://www.reddit.com/r/writing/comments/abc/hi/",
  }));
  const reddit = {
    getAvailableAccounts: () => ["acct"],
    resolveAccountName: (name?: string) => name ?? "acct",
    submitSelfPost,
  };
  // Only the Reddit service is available: anything reaching for ChatService or permissions would throw.
  const requireService = mock((service: unknown) => {
    if (service === RedditService) return reddit;
    throw new Error("unexpected service");
  });
  return { app: { requireService } as unknown as TokenRingApp, submitSelfPost, requireService };
}

describe("Reddit RPC", () => {
  it("lists connected accounts and the title limit", async () => {
    const { app } = fakeApp();
    expect(await redditRPC.methods.listAccounts.execute({}, app)).toEqual({ status: "success", accounts: [{ name: "acct" }], titleMaxLength: 300 });
  });

  it("submits a post through the same service call as the agent tool, without agent approval", async () => {
    const { app, submitSelfPost, requireService } = fakeApp();
    const result = await redditRPC.methods.submitPost.execute({ subreddit: "r/writing", title: "Hi", text: "Body", account: "acct" }, app);
    expect(submitSelfPost).toHaveBeenCalledWith("r/writing", "Hi", "Body", "acct");
    expect(result).toEqual({
      status: "success",
      account: "acct",
      subreddit: "writing",
      id: "t3_abc",
      url: "https://www.reddit.com/r/writing/comments/abc/hi/",
    });
    expect(requireService.mock.calls.every(([service]) => service === RedditService)).toBe(true);
  });

  it("surfaces the service's failure to the caller", async () => {
    const { app, submitSelfPost } = fakeApp();
    submitSelfPost.mockRejectedValueOnce(new Error("title is required"));
    await expect(redditRPC.methods.submitPost.execute({ subreddit: "writing", title: " ", text: "Body" }, app)).rejects.toThrow("title is required");
  });

  it("declares the methods the Social app calls", () => {
    expect(Object.keys(RedditRpcSchema.methods)).toEqual(["listAccounts", "submitPost"]);
  });
});
