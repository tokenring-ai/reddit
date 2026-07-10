import { beforeEach, describe, expect, it, mock } from "bun:test";
import { doFetchWithRetry } from "@tokenring-ai/utility/http/doFetchWithRetry";
import RedditService from "../RedditService.ts";
import RedditSocialMediaProvider from "../RedditSocialMediaProvider.ts";
import { RedditAccountSchema, RedditConfigSchema } from "../schema.ts";

void mock.module("@tokenring-ai/utility/http/doFetchWithRetry", () => ({
  doFetchWithRetry: mock(),
}));

const mockAgent = {} as any;

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

function fetchCall(index: number) {
  const call = (doFetchWithRetry as ReturnType<typeof mock>).mock.calls[index]!;
  return { url: String(call[0]), opts: call[1] as Record<string, unknown> };
}

function lastFetchCall() {
  const calls = (doFetchWithRetry as ReturnType<typeof mock>).mock.calls;
  return fetchCall(calls.length - 1);
}

const sampleListingChild = {
  data: {
    id: "abc123",
    name: "t3_abc123",
    title: "Hello Reddit",
    selftext: "Body",
    author: "tokenring",
    created_utc: 1735689600,
    num_comments: 4,
    score: 10,
    permalink: "/r/test/comments/abc123/hello_reddit/",
    url: "https://www.reddit.com/r/test/comments/abc123/hello_reddit/",
    subreddit: "test",
    is_self: true,
  },
};

describe("RedditService social provider behavior", () => {
  beforeEach(() => {
    mock.clearAllMocks();
  });

  it("fetches the authenticated Reddit account", async () => {
    (doFetchWithRetry as ReturnType<typeof mock>).mockResolvedValueOnce(
      jsonResponse({
        id: "acct-1",
        name: "tokenring",
        icon_img: "https://example.com/avatar.png",
        subreddit: {
          title: "Token Ring",
          public_description: "AI tooling",
        },
      }),
    );

    const reddit = new RedditService(RedditConfigSchema.parse({}));
    const provider = new RedditSocialMediaProvider(
      reddit,
      RedditAccountSchema.parse({
        accessToken: "secret",
      }),
    );

    const account = await provider.getAccount(mockAgent);

    expect(account.username).toBe("tokenring");
    expect(account.url).toBe("https://www.reddit.com/user/tokenring");
    const { url, opts } = lastFetchCall();
    expect(url).toBe("https://oauth.reddit.com/api/v1/me");
    expect(opts).toEqual(
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
        }),
      }),
    );
  });

  it("lists recent authenticated account submissions", async () => {
    (doFetchWithRetry as ReturnType<typeof mock>)
      .mockResolvedValueOnce(
        jsonResponse({
          id: "acct-1",
          name: "tokenring",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            children: [sampleListingChild],
          },
        }),
      );

    const reddit = new RedditService(RedditConfigSchema.parse({}));
    const provider = new RedditSocialMediaProvider(
      reddit,
      RedditAccountSchema.parse({
        accessToken: "secret",
      }),
    );

    const posts = await provider.getRecentPosts({ limit: 5 }, mockAgent);

    expect(posts).toHaveLength(1);
    expect(posts[0]!.id).toBe("abc123");
    expect(posts[0]!.title).toBe("Hello Reddit");
    expect(posts[0]!.metrics?.score).toBe(10);
    expect(lastFetchCall().url).toContain("/user/tokenring/submitted?limit=5");
  });

  it("creates a Reddit self post using subreddit metadata", async () => {
    (doFetchWithRetry as ReturnType<typeof mock>)
      .mockResolvedValueOnce(
        jsonResponse({
          json: {
            errors: [],
            data: {
              id: "abc123",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            children: [sampleListingChild],
          },
        }),
      );

    const reddit = new RedditService(RedditConfigSchema.parse({}));
    const provider = new RedditSocialMediaProvider(
      reddit,
      RedditAccountSchema.parse({
        accessToken: "secret",
      }),
    );

    const post = await provider.createPost(
      {
        title: "Hello Reddit",
        content: "Body",
        metadata: {
          subreddit: "test",
        },
      },
      mockAgent,
    );

    expect(post.id).toBe("abc123");
    const { url, opts } = fetchCall(0);
    expect(url).toBe("https://oauth.reddit.com/api/submit");
    expect(opts).toEqual(
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("sr=test"),
      }),
    );
  });

  it("refreshes an access token when only refresh credentials are configured", async () => {
    (doFetchWithRetry as ReturnType<typeof mock>)
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "fresh-token",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "acct-1",
          name: "tokenring",
        }),
      );

    const reddit = new RedditService(RedditConfigSchema.parse({}));
    const provider = new RedditSocialMediaProvider(
      reddit,
      RedditAccountSchema.parse({
        clientId: "client",
        clientSecret: "secret",
        refreshToken: "refresh-token",
      }),
    );

    const account = await provider.getAccount(mockAgent);

    expect(account.username).toBe("tokenring");
    const { url, opts } = fetchCall(0);
    expect(url).toBe("https://www.reddit.com/api/v1/access_token");
    expect(opts).toEqual(
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});
