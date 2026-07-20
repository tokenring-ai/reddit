import type { ConfigFieldMeta } from "@tokenring-ai/app/config/metadata";
import { secret } from "@tokenring-ai/secrets/secret";
import z from "zod";

/** OAuth token endpoint response. */
export const RedditAccessTokenSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional(),
});

/**
 * A Reddit account used as a messaging transport. What the account *does* — who
 * may talk to it, which subreddits it watches, which agent answers — is
 * configured on the bot that uses it, in the `bot` plugin.
 *
 * Provide either a ready `accessToken`, or `refreshToken` + `clientId` +
 * `clientSecret` so the provider can refresh OAuth tokens itself.
 */
export const RedditAccountConfigSchema = z.object({
  accessToken: secret({ description: "OAuth access token (Bearer)" }).exactOptional(),
  refreshToken: secret({ description: "OAuth refresh token" }).exactOptional(),
  clientId: z
    .string()
    .exactOptional()
    .meta({ description: "Reddit app client ID" } satisfies ConfigFieldMeta),
  clientSecret: secret({ description: "Reddit app client secret" }).exactOptional(),
  oauthBaseUrl: z
    .string()
    .default("https://oauth.reddit.com")
    .meta({ advanced: true, description: "Reddit OAuth API base URL" } satisfies ConfigFieldMeta),
  tokenUrl: z
    .string()
    .default("https://www.reddit.com/api/v1/access_token")
    .meta({ advanced: true, description: "OAuth token endpoint" } satisfies ConfigFieldMeta),
  userAgent: z
    .string()
    .default("TokenRing-One/1.0 (https://github.com/tokenring-ai/one)")
    .meta({
      advanced: true,
      description: "User-Agent sent with Reddit API requests (Reddit requires a descriptive UA)",
    } satisfies ConfigFieldMeta),
  pollIntervalMs: z
    .number()
    .int()
    .min(10_000)
    .default(30_000)
    .meta({
      advanced: true,
      description: "How often, in milliseconds, to poll the inbox for new messages and comment replies",
    } satisfies ConfigFieldMeta),
  maxMessageLength: z
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(10_000)
    .meta({ advanced: true, description: "Longest single comment or PM the account will send" } satisfies ConfigFieldMeta),
  markRead: z
    .boolean()
    .default(true)
    .meta({ advanced: true, description: "Mark inbox items as read after delivering them to a bot" } satisfies ConfigFieldMeta),
});

export type ParsedRedditAccountConfig = z.output<typeof RedditAccountConfigSchema>;

/**
 * Account as handed to the service, with secret refs resolved to plain strings.
 * Optional credentials stay optional (unlike {@link WithResolvedSecrets}, which
 * would force every listed key to be present).
 */
export type ResolvedRedditAccountConfig = Omit<ParsedRedditAccountConfig, "accessToken" | "refreshToken" | "clientSecret"> & {
  accessToken?: string;
  refreshToken?: string;
  clientSecret?: string;
};

export const RedditServiceConfigSchema = z
  .object({
    accounts: z
      .record(z.string(), RedditAccountConfigSchema)
      .default({})
      .meta({ label: "Accounts", description: "Reddit accounts, keyed by the service name bots address them by" } satisfies ConfigFieldMeta),
    publicBaseUrl: z
      .string()
      .default("https://www.reddit.com")
      .meta({
        advanced: true,
        description: "Public Reddit base URL used by research tools (search, latest posts)",
      } satisfies ConfigFieldMeta),
    userAgent: z
      .string()
      .default("TokenRing-One/1.0 (https://github.com/tokenring-ai/one)")
      .meta({ advanced: true, description: "Default User-Agent for public (unauthenticated) API calls" } satisfies ConfigFieldMeta),
  })
  .meta({ label: "Reddit", description: "Reddit accounts for bot messaging and research tools" } satisfies ConfigFieldMeta);

export type ParsedRedditServiceConfig = z.output<typeof RedditServiceConfigSchema>;

export type ResolvedRedditServiceConfig = {
  accounts: Record<string, ResolvedRedditAccountConfig>;
  publicBaseUrl: string;
  userAgent: string;
};

// --- Listing schemas used by research tools and validated OAuth responses ---

export const RedditFlairRichtextSchema = z
  .object({
    e: z.string().optional(),
    t: z.string().optional(),
    a: z.string().optional(),
    u: z.string().optional(),
  })
  .loose();

export const RedditThingDataSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    permalink: z.string().optional(),
    url: z.string().optional(),
    subreddit: z.string().optional(),
    author: z.string().optional(),
    author_fullname: z.string().optional(),
    title: z.string().optional(),
    selftext: z.string().optional(),
    body: z.string().optional(),
    subject: z.string().optional(),
    is_self: z.boolean().optional(),
    score: z.number().optional(),
    num_comments: z.number().optional(),
    created_utc: z.number().optional(),
    link_id: z.string().optional(),
    parent_id: z.string().optional(),
    was_comment: z.boolean().optional(),
    new: z.boolean().optional(),
    dest: z.string().optional(),
    likes: z.boolean().nullable().optional(),
    upvote_ratio: z.number().optional(),
  })
  .loose();

export const RedditThingSchema = z
  .object({
    kind: z.string().optional(),
    data: RedditThingDataSchema,
  })
  .loose();

export const RedditListingResponseSchema = z
  .object({
    data: z
      .object({
        children: z.array(RedditThingSchema).default([]),
        after: z.string().nullable().optional(),
        before: z.string().nullable().optional(),
      })
      .prefault({}),
  })
  .loose();

export const RedditMeSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    name: z.string(),
    icon_img: z.string().optional(),
    snoovatar_img: z.string().optional(),
  })
  .loose();

export const RedditJsonActionSchema = z
  .object({
    json: z
      .object({
        errors: z.array(z.unknown()).optional(),
        data: z
          .object({
            id: z.string().optional(),
            things: z
              .array(
                z
                  .object({
                    data: z
                      .object({
                        id: z.string().optional(),
                        name: z.string().optional(),
                      })
                      .loose()
                      .optional(),
                  })
                  .loose(),
              )
              .optional(),
          })
          .loose()
          .optional(),
      })
      .loose()
      .optional(),
  })
  .loose();
