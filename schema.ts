import {z} from "zod";

export const RedditAccountSchema = z
  .object({
    baseUrl: z.string().optional(),
    publicBaseUrl: z.string().optional(),
    oauthBaseUrl: z.string().default("https://oauth.reddit.com"),
    userAgent: z
      .string()
      .default("TokenRing/1.0 (https://github.com/tokenring-ai/monorepo)"),
    accessToken: z.string().optional(),
    refreshToken: z.string().optional(),
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    username: z.string().optional(),
    defaultSubreddit: z.string().optional(),
    social: z.boolean().optional(),
  })
  .transform((config) => ({
    ...config,
    publicBaseUrl:
      config.publicBaseUrl ?? config.baseUrl ?? "https://www.reddit.com",
  }));

export type ParsedRedditAccount = z.output<typeof RedditAccountSchema>;

export const RedditConfigSchema = z.object({
  accounts: z.record(z.string(), RedditAccountSchema).default({}),
});

export type ParsedRedditConfig = z.output<typeof RedditConfigSchema>;

// Keep for backwards compat with RedditService constructor
export const RedditServiceConfigSchema = RedditAccountSchema;
