import { describe, expect, it } from "bun:test";
import { type ParsedRedditServiceConfig, RedditAccountConfigSchema, RedditServiceConfigSchema } from "../schema.ts";

describe("Reddit service configuration", () => {
  it("validates multiple accounts", () => {
    const result = RedditServiceConfigSchema.safeParse({
      accounts: {
        primary: { accessToken: "token-a" },
        support: {
          refreshToken: "refresh-b",
          clientId: "client",
          clientSecret: "secret",
          pollIntervalMs: 60_000,
        },
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accounts.primary!.pollIntervalMs).toBe(30_000);
      expect(result.data.accounts.primary!.maxMessageLength).toBe(10_000);
      expect(result.data.accounts.support!.pollIntervalMs).toBe(60_000);
    }
  });

  it("defaults to no accounts", () => {
    expect(RedditServiceConfigSchema.parse({})).toEqual({
      accounts: {},
      publicBaseUrl: "https://www.reddit.com",
      userAgent: "TokenRing-One/1.0 (https://github.com/tokenring-ai/one)",
    });
  });

  it("applies account defaults", () => {
    expect(RedditAccountConfigSchema.parse({ accessToken: "token" })).toEqual({
      accessToken: "token",
      oauthBaseUrl: "https://oauth.reddit.com",
      tokenUrl: "https://www.reddit.com/api/v1/access_token",
      userAgent: "TokenRing-One/1.0 (https://github.com/tokenring-ai/one)",
      pollIntervalMs: 30_000,
      maxMessageLength: 10_000,
      markRead: true,
    });
  });

  it("rejects a poll interval below the minimum", () => {
    const result = RedditAccountConfigSchema.safeParse({ accessToken: "token", pollIntervalMs: 1000 });
    expect(result.success).toBe(false);
  });

  it("infers parsed config type from schema output", () => {
    const config: ParsedRedditServiceConfig = {
      accounts: {
        default: {
          accessToken: "token",
          oauthBaseUrl: "https://oauth.reddit.com",
          tokenUrl: "https://www.reddit.com/api/v1/access_token",
          userAgent: "test",
          pollIntervalMs: 15_000,
          maxMessageLength: 5000,
          markRead: false,
        },
      },
      publicBaseUrl: "https://www.reddit.com",
      userAgent: "test",
    };
    expect(config.accounts.default!.markRead).toBe(false);
  });
});
