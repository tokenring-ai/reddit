import type { TokenRingService } from "@tokenring-ai/app/types";
import { doFetchWithRetry } from "@tokenring-ai/utility/http/doFetchWithRetry";
import { HttpService } from "@tokenring-ai/utility/http/HttpService";
import type { SocialMediaPost } from "../social/index.ts";
import type { ParsedRedditAccount } from "./schema.ts";

export type RedditSearchOptions = {
  limit?: number | undefined;
  sort?: "relevance" | "hot" | "top" | "new" | "comments";
  t?: "hour" | "day" | "week" | "month" | "year" | "all";
  after?: string | undefined;
  before?: string | undefined;
};

export type RedditListingOptions = {
  limit?: number | undefined;
  after?: string | undefined;
  before?: string | undefined;
};

export default class RedditService extends HttpService implements TokenRingService {
  readonly name = "RedditService";
  description = "Service for searching Reddit posts and retrieving content";

  protected baseUrl: string;
  protected defaultHeaders: Record<string, string>;

  constructor(private readonly config: Pick<ParsedRedditAccount, "publicBaseUrl" | "userAgent">) {
    super();
    this.baseUrl = config.publicBaseUrl;
    this.defaultHeaders = {
      "User-Agent": config.userAgent,
    };
  }

  searchSubreddit(subreddit: string, query: string, opts: RedditSearchOptions = {}): Promise<any> {
    if (!subreddit) throw new Error("subreddit is required");
    if (!query) throw new Error("query is required");

    const params = new URLSearchParams({
      q: query,
      restrict_sr: "true",
      limit: String(opts.limit || 25),
      sort: opts.sort || "relevance",
      raw_json: "1",
      ...(opts.t && { t: opts.t }),
      ...(opts.after && { after: opts.after }),
      ...(opts.before && { before: opts.before }),
    });

    return this.fetchJson(`/r/${subreddit}/search.json?${params}`, { method: "GET" }, "Reddit search");
  }

  async retrievePost(postUrl: string): Promise<any> {
    if (!postUrl) throw new Error("postUrl is required");

    const jsonUrl = postUrl.endsWith(".json") ? postUrl : `${postUrl}.json`;
    const res = await doFetchWithRetry(jsonUrl, {
      method: "GET",
      headers: this.defaultHeaders,
    });
    return this.parseJsonOrThrow(res, "Reddit post retrieval");
  }

  getLatestPosts(subreddit: string, opts: RedditListingOptions = {}): Promise<any> {
    if (!subreddit) throw new Error("subreddit is required");

    const params = new URLSearchParams({
      limit: String(opts.limit || 25),
      raw_json: "1",
      ...(opts.after && { after: opts.after }),
      ...(opts.before && { before: opts.before }),
    });

    return this.fetchJson(`/r/${subreddit}/new.json?${params}`, { method: "GET" }, "Reddit latest posts");
  }

  mapRedditThingToPost(post: any, username?: string): SocialMediaPost {
    const id = String(post.id ?? "").replace(/^t3_/, "");
    const resolvedUsername: string = post.author ?? username ?? "unknown";
    const createdAt = post.created_utc ? new Date(post.created_utc * 1000) : new Date();
    const linkUrl = post.is_self ? undefined : post.url;

    return {
      id,
      platform: "reddit",
      title: post.title ?? undefined,
      content: post.selftext || linkUrl || "",
      status: "published",
      url: post.permalink ? `https://www.reddit.com${post.permalink}` : post.url,
      author: {
        id: typeof post.author_fullname === "string" ? post.author_fullname.replace(/^t2_/, "") : undefined,
        username: resolvedUsername,
        url: `https://www.reddit.com/user/${resolvedUsername}`,
      },
      createdAt,
      publishedAt: createdAt,
      ...(linkUrl && {
        attachments: [{ type: "link", url: linkUrl }],
      }),
      metrics: {
        comments: post.num_comments,
        score: post.score,
      },
      metadata: {
        subreddit: post.subreddit,
        fullname: post.name,
        isSelf: post.is_self,
        upvoteRatio: post.upvote_ratio,
      },
    };
  }
}
