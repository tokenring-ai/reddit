import type { Agent } from "@tokenring-ai/agent";
import { HTTPRetriever } from "@tokenring-ai/utility/http/HTTPRetriever";
import { stripUndefinedKeys } from "@tokenring-ai/utility/object/stripObject";
import { Buffer } from "node:buffer";
import { z } from "zod";
import type { CreateSocialMediaPostData, SocialMediaAccount, SocialMediaPost, SocialMediaPostFilterOptions, SocialMediaProvider } from "../social/index.ts";
import type RedditService from "./RedditService.ts";
import { type ParsedRedditAccount, RedditAccessTokenSchema, RedditListingResponseSchema } from "./schema.ts";

const RedditCreatePostResponseSchema = z.object({
  json: z
    .object({
      errors: z.array(z.unknown()).optional(),
      data: z
        .object({
          id: z.string().optional(),
        })

        .optional(),
    })

    .optional(),
});

const RedditAccountResponseSchema = z.object({
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

    .optional(),
});

export default class RedditSocialMediaProvider implements SocialMediaProvider {
  description = "Reddit social media provider";
  private accessToken?: string | undefined;
  private accountPromise?: Promise<SocialMediaAccount>;

  private readonly retriever: HTTPRetriever;

  constructor(
    private readonly reddit: RedditService,
    private readonly config: ParsedRedditAccount,
  ) {
    this.accessToken = config.accessToken;
    this.retriever = new HTTPRetriever({
      baseUrl: config.oauthBaseUrl,
      headers: { "User-Agent": reddit.config.userAgent },
      timeout: 10_000,
    });
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
    const token = await this.getAccessToken();
    const response = await this.retriever.fetchValidatedJson({
      url: `/user/${account.username}/submitted?${params}`,
      opts: {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      schema: RedditListingResponseSchema,
      context: "Reddit account posts",
    });
    return response.data.children.map(child => this.reddit.mapRedditThingToPost(child.data, account.username));
  }

  async getPostById(id: string, _agent: Agent): Promise<SocialMediaPost> {
    if (!id) throw new Error("id is required");
    const fullname = id.startsWith("t3_") ? id : `t3_${id}`;
    const token = await this.getAccessToken();
    const response = await this.retriever.fetchValidatedJson({
      url: `/api/info?id=${encodeURIComponent(fullname)}&raw_json=1`,
      opts: {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      schema: RedditListingResponseSchema,
      context: "Reddit post lookup",
    });
    const post = response.data?.children[0]?.data;
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

    const token = await this.getAccessToken();
    const response = await this.retriever.fetchValidatedJson({
      url: "/api/submit",
      opts: {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${token}`,
        },
        body: body.toString(),
      },
      schema: RedditCreatePostResponseSchema,
      context: "Reddit create post",
    });

    const errors = response.json?.errors ?? [];
    if (errors.length > 0) throw new Error(`Reddit create post failed: ${JSON.stringify(errors)}`);

    const createdId = response.json?.data?.id;
    if (!createdId) throw new Error("Reddit create post did not return a post id");
    return this.getPostById(createdId, agent);
  }

  private async fetchAccount(): Promise<SocialMediaAccount> {
    const token = await this.getAccessToken();
    const response = await this.retriever.fetchValidatedJson({
      url: "/api/v1/me",
      opts: {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      schema: RedditAccountResponseSchema,
      context: "Reddit current account lookup",
    });
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

    const { access_token } = await this.retriever.fetchValidatedJson({
      url: `${this.reddit.config.baseUrl}/api/v1/access_token`,
      opts: {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      },
      schema: RedditAccessTokenSchema,
      context: "Reddit token refresh",
    });

    this.accessToken = access_token;
    return access_token;
  }
}
