import type TokenRingApp from "@tokenring-ai/app";
import { createRPCEndpoint } from "@tokenring-ai/rpc/createRPCEndpoint";
import RedditService from "../RedditService.ts";
import RedditRpcSchema from "./schema.ts";
import { REDDIT_TITLE_MAX } from "./titleMax.ts";

export default createRPCEndpoint(RedditRpcSchema, {
  listAccounts(_args, app: TokenRingApp) {
    const accounts = app
      .requireService(RedditService)
      .getAvailableAccounts()
      .map(name => ({ name }));
    return { status: "success", accounts, titleMaxLength: REDDIT_TITLE_MAX };
  },

  async submitPost({ subreddit, title, text, account }, app: TokenRingApp) {
    // Same service call as the reddit_submitPost agent tool, minus the agent approval: clicking Post is the approval.
    const reddit = app.requireService(RedditService);
    const accountName = reddit.resolveAccountName(account);
    const post = await reddit.submitSelfPost(subreddit, title, text, accountName);
    return {
      status: "success",
      account: accountName,
      subreddit: subreddit
        .trim()
        .replace(/^\/?r\//i, "")
        .trim(),
      id: post.name,
      ...(post.url && { url: post.url }),
    };
  },
});
