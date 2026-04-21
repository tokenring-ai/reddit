import { z } from "zod";

export const RedditAccountSchema = z
  .object({
    baseUrl: z.string().exactOptional(),
    publicBaseUrl: z.string().exactOptional(),
    oauthBaseUrl: z.string().default("https://oauth.reddit.com"),
    userAgent: z.string().default("TokenRing/1.0 (https://github.com/tokenring-ai/monorepo)"),
    accessToken: z.string().exactOptional(),
    refreshToken: z.string().exactOptional(),
    clientId: z.string().exactOptional(),
    clientSecret: z.string().exactOptional(),
    username: z.string().exactOptional(),
    defaultSubreddit: z.string().exactOptional(),
    social: z.boolean().exactOptional(),
  })
  .transform(config => ({
    ...config,
    publicBaseUrl: config.publicBaseUrl ?? config.baseUrl ?? "https://www.reddit.com",
  }));

export type ParsedRedditAccount = z.output<typeof RedditAccountSchema>;

export const RedditConfigSchema = z.object({
  accounts: z.record(z.string(), RedditAccountSchema).default({}),
});

export type ParsedRedditConfig = z.output<typeof RedditConfigSchema>;
