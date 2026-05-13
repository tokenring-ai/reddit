import { Buffer } from "node:buffer";
import type { Agent } from "@tokenring-ai/agent";
import { doFetchWithRetry } from "@tokenring-ai/utility/http/doFetchWithRetry";
import { stripUndefinedKeys } from "@tokenring-ai/utility/object/stripObject";
import { z } from "zod";
import type { CreateSocialMediaPostData, SocialMediaAccount, SocialMediaPost, SocialMediaPostFilterOptions, SocialMediaProvider } from "../social/index.ts";
import type RedditService from "./RedditService.ts";
import type { ParsedRedditAccount } from "./schema.ts";

const RedditThingSchema = z
  .object({
    data: z.record(z.string(), z.unknown()),
  })
  .passthrough();

const RedditListingSchema = z
  .object({
    data: z
      .object({
        children: z.array(RedditThingSchema).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const RedditCreatePostResponseSchema = z
  .object({
    json: z
      .object({
        errors: z.array(z.unknown()).optional(),
        data: z
          .object({
            id: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const RedditAccountResponseSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    name: z.string().optional(),
    icon_img: z.string().optional(),
    snoovatar_img: z.string().optional(),
    has_verified_email: z.boolean().optional(),
    subreddit: z
      .object({
        title: z.string().optional(),
        public_description: z.string().optional(),
        description: z.string().optional(),
        icon_img: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export default class RedditSocialMediaProvider implements SocialMediaProvider {
  description = "Reddit social media provider";
  private accessToken?: string | undefined;
  private accountPromise?: Promise<SocialMediaAccount>;

  constructor(
    private readonly reddit: RedditService,
    private readonly config: ParsedRedditAccount,
  ) {
    this.accessToken = config.accessToken;
  }

  getAccount(_agent: Agent): Promise<SocialMediaAccount> {
    this.accountPromise ??= this.fetchAccount();
    return this.accountPromise;
  }

  async getRecentPosts(filter: SocialMediaPostFilterOptions, agent: Agent): Promise<SocialMediaPost[]> {
    const account = await this.getAccount(agent);
    const params = new URLSearchParams({
      limit: String(Math.min(filter.limit ?? 10, 100)),
      raw_json: "1",
    });
    const response = await this.authFetchJson(`/user/${account.username}/submitted?${params}`, { method: "GET" }, "Reddit account posts", RedditListingSchema);
    return (response.data?.children ?? []).map((child: any) => this.reddit.mapRedditThingToPost(child.data, account.username));
  }

  async getPostById(id: string, _agent: Agent): Promise<SocialMediaPost> {
    if (!id) throw new Error("id is required");
    const fullname = id.startsWith("t3_") ? id : `t3_${id}`;
    const response = await this.authFetchJson(
      `/api/info?id=${encodeURIComponent(fullname)}&raw_json=1`,
      { method: "GET" },
      "Reddit post lookup",
      RedditListingSchema,
    );
    const post = response.data?.children?.[0]?.data;
    if (!post) throw new Error(`Reddit post ${id} not found`);
    return this.reddit.mapRedditThingToPost(post);
  }

  async createPost(data: CreateSocialMediaPostData, agent: Agent): Promise<SocialMediaPost> {
    const subreddit = typeof data.metadata?.subreddit === "string" ? data.metadata.subreddit : this.config.defaultSubreddit;
    if (!subreddit) throw new Error("Reddit posting requires metadata.subreddit or defaultSubreddit");
    if (!data.title?.trim()) throw new Error("Reddit posting requires a title");

    const linkUrl = typeof data.metadata?.url === "string" ? data.metadata.url : undefined;
    const kind = typeof data.metadata?.kind === "string" ? data.metadata.kind : linkUrl ? "link" : "self";

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
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      "Reddit create post",
      RedditCreatePostResponseSchema,
    );

    const errors = response.json?.errors ?? [];
    if (errors.length > 0) throw new Error(`Reddit create post failed: ${JSON.stringify(errors)}`);

    const createdId = response.json?.data?.id;
    if (!createdId) throw new Error("Reddit create post did not return a post id");
    return this.getPostById(createdId, agent);
  }

  private async fetchAccount(): Promise<SocialMediaAccount> {
    const response = await this.authFetchJson("/api/v1/me", { method: "GET" }, "Reddit current account lookup", RedditAccountResponseSchema);
    const username = response.name ?? this.config.username;
    if (!username) throw new Error("Reddit account lookup did not return a username");
    return stripUndefinedKeys({
      id: String(response.id),
      username,
      displayName: response.subreddit?.title ?? username,
      description: response.subreddit?.public_description ?? response.subreddit?.description,
      avatarUrl: response.icon_img || response.snoovatar_img || response.subreddit?.icon_img,
      url: `https://www.reddit.com/user/${username}`,
      metadata: stripUndefinedKeys({ hasVerifiedEmail: response.has_verified_email }),
    });
  }

  private async authFetchJson<T extends z.ZodType>(
    path: string,
    opts: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
    context: string,
    schema: T,
  ): Promise<z.output<T>> {
    const token = await this.getAccessToken();
    const res = await doFetchWithRetry(`${this.config.oauthBaseUrl}${path}`, {
      ...opts,
      headers: {
        "User-Agent": this.config.userAgent,
        Authorization: `Bearer ${token}`,
        ...opts.headers,
      },
    });
    if (!res.ok) throw new Error(`${context} failed: ${res.status} ${res.statusText}`);
    return schema.parse(await res.json());
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
    if (!res.ok) throw new Error(`Reddit token refresh failed: ${res.status}`);
    const data = await res.json();
    if (!data.access_token) throw new Error("Reddit token refresh did not return an access token");
    this.accessToken = data.access_token;
    return data.access_token;
  }
}
