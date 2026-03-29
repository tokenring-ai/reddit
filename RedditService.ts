import {Agent} from "@tokenring-ai/agent";
import {TokenRingService} from "@tokenring-ai/app/types";
import type {
  CreateSocialMediaPostData,
  SocialMediaAccount,
  SocialMediaPost,
  SocialMediaPostFilterOptions,
  SocialMediaProvider,
} from "../social/index.ts";
import {doFetchWithRetry} from "@tokenring-ai/utility/http/doFetchWithRetry";
import {HttpService} from "@tokenring-ai/utility/http/HttpService";
import {Buffer} from "node:buffer";
import type {ParsedRedditConfig} from "./schema.ts";

export type RedditSearchOptions = {
  limit?: number;
  sort?: "relevance" | "hot" | "top" | "new" | "comments";
  t?: "hour" | "day" | "week" | "month" | "year" | "all";
  after?: string;
  before?: string;
};

export type RedditListingOptions = {
  limit?: number;
  after?: string;
  before?: string;
};

export default class RedditService extends HttpService implements TokenRingService, SocialMediaProvider {
  readonly name = "RedditService";
  description = "Service for searching Reddit posts and retrieving content";

  protected baseUrl: string;
  protected defaultHeaders: Record<string, string>;

  private accessToken?: string;
  private accountPromise?: Promise<SocialMediaAccount>;

  constructor(private readonly config: ParsedRedditConfig) {
    super();
    this.baseUrl = config.publicBaseUrl;
    this.defaultHeaders = {
      "User-Agent": config.userAgent,
    };
    this.accessToken = config.accessToken;
  }

  async searchSubreddit(subreddit: string, query: string, opts: RedditSearchOptions = {}): Promise<any> {
    if (!subreddit) throw new Error("subreddit is required");
    if (!query) throw new Error("query is required");

    const params = new URLSearchParams({
      q: query,
      restrict_sr: "true",
      limit: String(opts.limit || 25),
      sort: opts.sort || "relevance",
      raw_json: "1",
      ...(opts.t && {t: opts.t}),
      ...(opts.after && {after: opts.after}),
      ...(opts.before && {before: opts.before}),
    });

    return this.fetchJson(`/r/${subreddit}/search.json?${params}`, {method: "GET"}, "Reddit search");
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

  async getLatestPosts(subreddit: string, opts: RedditListingOptions = {}): Promise<any> {
    if (!subreddit) throw new Error("subreddit is required");

    const params = new URLSearchParams({
      limit: String(opts.limit || 25),
      raw_json: "1",
      ...(opts.after && {after: opts.after}),
      ...(opts.before && {before: opts.before}),
    });

    return this.fetchJson(`/r/${subreddit}/new.json?${params}`, {method: "GET"}, "Reddit latest posts");
  }

  async getAccount(_agent: Agent): Promise<SocialMediaAccount> {
    if (!this.accountPromise) {
      this.accountPromise = this.fetchAccount();
    }
    return await this.accountPromise;
  }

  async getRecentPosts(filter: SocialMediaPostFilterOptions, agent: Agent): Promise<SocialMediaPost[]> {
    const account = await this.getAccount(agent);
    const params = new URLSearchParams({
      limit: String(Math.min(filter.limit ?? 10, 100)),
      raw_json: "1",
    });

    const response = await this.authFetchJson(
      `/user/${account.username}/submitted?${params.toString()}`,
      {method: "GET"},
      "Reddit account posts",
    );

    return (response.data?.children ?? []).map((child: any) => this.mapRedditThingToPost(child.data, account));
  }

  async getPostById(id: string, _agent: Agent): Promise<SocialMediaPost> {
    if (!id) throw new Error("id is required");
    const fullname = id.startsWith("t3_") ? id : `t3_${id}`;
    const response = await this.authFetchJson(
      `/api/info?id=${encodeURIComponent(fullname)}&raw_json=1`,
      {method: "GET"},
      "Reddit post lookup",
    );

    const post = response.data?.children?.[0]?.data;
    if (!post) throw new Error(`Reddit post ${id} not found`);
    return this.mapRedditThingToPost(post);
  }

  async createPost(data: CreateSocialMediaPostData, agent: Agent): Promise<SocialMediaPost> {
    const subreddit = typeof data.metadata?.subreddit === "string"
      ? data.metadata.subreddit
      : this.config.defaultSubreddit;
    if (!subreddit) throw new Error("Reddit posting requires metadata.subreddit or defaultSubreddit");
    if (!data.title?.trim()) throw new Error("Reddit posting requires a title");

    const linkUrl = typeof data.metadata?.url === "string" ? data.metadata.url : undefined;
    const kind = typeof data.metadata?.kind === "string"
      ? data.metadata.kind
      : (linkUrl ? "link" : "self");

    const body = new URLSearchParams({
      api_type: "json",
      sr: subreddit,
      kind,
      title: data.title,
      resubmit: "true",
      sendreplies: "true",
    });

    if (kind === "link") {
      if (!linkUrl) throw new Error("Reddit link posts require metadata.url");
      body.set("url", linkUrl);
    } else {
      body.set("text", data.content);
    }

    const response = await this.authFetchJson(
      "/api/submit",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      },
      "Reddit create post",
    );

    const errors = response.json?.errors ?? [];
    if (errors.length > 0) {
      throw new Error(`Reddit create post failed: ${JSON.stringify(errors)}`);
    }

    const createdId = response.json?.data?.id;
    if (!createdId) throw new Error("Reddit create post did not return a post id");
    return await this.getPostById(createdId, agent);
  }

  private async fetchAccount(): Promise<SocialMediaAccount> {
    const response = await this.authFetchJson(
      "/api/v1/me",
      {method: "GET"},
      "Reddit current account lookup",
    );

    const username = response.name ?? this.config.username;
    if (!username) throw new Error("Reddit account lookup did not return a username");

    return {
      id: String(response.id),
      username,
      displayName: response.subreddit?.title ?? username,
      description: response.subreddit?.public_description ?? response.subreddit?.description,
      avatarUrl: response.icon_img || response.snoovatar_img || response.subreddit?.icon_img,
      url: `https://www.reddit.com/user/${username}`,
      metadata: {
        hasVerifiedEmail: response.has_verified_email,
      },
    };
  }

  private mapRedditThingToPost(post: any, account?: SocialMediaAccount): SocialMediaPost {
    const id = String(post.id ?? "").replace(/^t3_/, "");
    const username = post.author ?? account?.username ?? this.config.username ?? "unknown";
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
        id: typeof post.author_fullname === "string" ? post.author_fullname.replace(/^t2_/, "") : account?.id,
        username,
        url: `https://www.reddit.com/user/${username}`,
      },
      createdAt,
      publishedAt: createdAt,
      attachments: linkUrl ? [{type: "link", url: linkUrl}] : undefined,
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

  private async authFetchJson(path: string, opts: RequestInit, context: string): Promise<any> {
    const token = await this.getAccessToken();
    const res = await doFetchWithRetry(`${this.config.oauthBaseUrl}${path}`, {
      ...opts,
      headers: {
        ...this.defaultHeaders,
        Authorization: `Bearer ${token}`,
        ...(opts.headers ?? {}),
      },
    });
    return this.parseJsonOrThrow(res, context);
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    if (!this.config.refreshToken || !this.config.clientId || !this.config.clientSecret) {
      throw new Error("Reddit account operations require accessToken or refreshToken/clientId/clientSecret");
    }

    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.config.refreshToken,
    });

    const res = await doFetchWithRetry(`${this.config.publicBaseUrl}/api/v1/access_token`, {
      method: "POST",
      headers: {
        "User-Agent": this.config.userAgent,
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const response = await this.parseJsonOrThrow(res, "Reddit token refresh");
    if (!response.access_token) throw new Error("Reddit token refresh did not return an access token");
    this.accessToken = response.access_token;
    return response.access_token;
  }
}
