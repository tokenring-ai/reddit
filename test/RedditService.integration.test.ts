import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import createTestingAgent from "@tokenring-ai/agent/test/createTestingAgent.test";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import { doFetchWithRetry } from "@tokenring-ai/utility/http/doFetchWithRetry";
import plugin from "../plugin.ts";
import RedditService from "../RedditService.ts";
import getLatestPostsTool from "../tools/getLatestPosts.ts";
import retrievePostTool from "../tools/retrievePost.ts";
import searchSubredditTool from "../tools/searchSubreddit.ts";

void mock.module("@tokenring-ai/utility/http/doFetchWithRetry", () => ({
  doFetchWithRetry: mock(),
}));

function listingChild(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: "post1",
      name: "t3_post1",
      title: "Test Post 1",
      selftext: "Test content",
      url: "https://reddit.com/test1",
      author: "testuser1",
      created_utc: Date.now(),
      permalink: "/r/test/comments/post1/test_post_1/",
      subreddit: "test",
      ...overrides,
    },
  };
}

function listingResponse(
  children = [
    listingChild(),
    listingChild({
      id: "post2",
      name: "t3_post2",
      title: "Test Post 2",
      selftext: "More test content",
      url: "https://reddit.com/test2",
      author: "testuser2",
      permalink: "/r/test/comments/post2/test_post_2/",
    }),
  ],
) {
  return {
    ok: true,
    status: 200,
    text: () =>
      Promise.resolve(
        JSON.stringify({
          data: { children },
        }),
      ),
  };
}

function lastFetchUrl() {
  const calls = (doFetchWithRetry as ReturnType<typeof mock>).mock.calls;
  return String(calls[calls.length - 1]![0]);
}

function service() {
  return new RedditService(createTestingApp() as any);
}

describe("RedditService research helpers", () => {
  beforeEach(() => {
    mock.clearAllMocks();
    (doFetchWithRetry as ReturnType<typeof mock>).mockResolvedValue(listingResponse());
  });

  it("searches a subreddit", async () => {
    const reddit = service();
    const result = await reddit.searchSubreddit("programming", "javascript", { limit: 3 });

    expect(result.data.children).toBeInstanceOf(Array);
    expect(result.data.children.length).toBeGreaterThan(0);
    expect(result.data.children[0]!.data).toHaveProperty("title");
    expect(doFetchWithRetry).toHaveBeenCalled();
  });

  it("throws for empty subreddit or query", () => {
    const reddit = service();
    expect(() => reddit.searchSubreddit("", "test")).toThrow("subreddit is required");
    expect(() => reddit.searchSubreddit("test", "")).toThrow("query is required");
  });

  it("retrieves a post by URL", async () => {
    const postUrl = "https://www.reddit.com/r/announcements/comments/5q4qmg/out_with_2016_in_with_2017/";
    (doFetchWithRetry as ReturnType<typeof mock>).mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify([
            {
              data: {
                children: [
                  {
                    data: {
                      id: "5q4qmg",
                      name: "t3_5q4qmg",
                      title: "Test Post Title",
                      selftext: "Test post content",
                      url: postUrl,
                      author: "testuser",
                      created_utc: Date.now(),
                      permalink: "/r/announcements/comments/5q4qmg/out_with_2016_in_with_2017/",
                      subreddit: "announcements",
                    },
                  },
                ],
              },
            },
          ]),
        ),
    } as unknown as Response);

    const content = (await service().retrievePost(postUrl)) as Array<{ data: { children: Array<{ data: any }> } }>;
    expect(content[0]!.data.children[0]!.data).toHaveProperty("title");
    expect(lastFetchUrl()).toContain(".json");
  });

  it("throws for empty post URL", async () => {
    await expect(service().retrievePost("")).rejects.toThrow("postUrl is required");
  });

  it("gets latest posts", async () => {
    const result = await service().getLatestPosts("programming", { limit: 5 });
    expect(result.data.children.length).toBeGreaterThan(0);
    expect(result.data.children[0]!.data).toHaveProperty("title");
  });

  it("throws for empty subreddit in getLatestPosts", () => {
    expect(() => service().getLatestPosts("")).toThrow("subreddit is required");
  });

  it("surfaces HTTP errors", async () => {
    (doFetchWithRetry as ReturnType<typeof mock>).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    } as any);

    await expect(service().searchSubreddit("programming", "test")).rejects.toThrow("Reddit search failed (500)");
  });

  it("has the expected service identity", () => {
    const reddit = service();
    expect(reddit.name).toBe("RedditService");
    expect(reddit.description).toContain("bot service");
  });
});

describe("Reddit tools", () => {
  let mockAgent: any;
  let mockRedditService: any;

  beforeEach(() => {
    mock.clearAllMocks();
    const app = createTestingApp();
    mockAgent = createTestingAgent(app);
    spyOn(mockAgent, "infoMessage").mockResolvedValue(undefined);

    mockRedditService = {
      searchSubreddit: mock(),
      retrievePost: mock(),
      getLatestPosts: mock(),
    };
    app.addService(mockRedditService);
    spyOn(mockAgent, "requireService").mockReturnValue(mockRedditService);
  });

  it("exposes tool metadata", () => {
    expect(searchSubredditTool.name).toBe("reddit_searchSubreddit");
    expect(retrievePostTool.name).toBe("reddit_retrievePost");
    expect(getLatestPostsTool.name).toBe("reddit_getLatestPosts");
  });

  it("executes searchSubreddit", async () => {
    const mockResults = { data: { children: [{ data: { title: "Test" } }] } };
    mockRedditService.searchSubreddit.mockResolvedValue(mockResults);

    const result = await searchSubredditTool.execute({ subreddit: "programming", query: "javascript", limit: 10 }, mockAgent);
    expect(mockRedditService.searchSubreddit).toHaveBeenCalledWith("programming", "javascript", expect.objectContaining({ limit: 10 }));
    expect(JSON.parse(result.result as string)).toEqual(mockResults);
  });

  it("executes retrievePost", async () => {
    mockRedditService.retrievePost.mockResolvedValue({ data: { title: "Test Post" } });
    const result = await retrievePostTool.execute({ postUrl: "https://www.reddit.com/r/test/comments/123/test/" }, mockAgent);
    expect(JSON.parse(result.result as string)).toEqual({ data: { title: "Test Post" } });
  });

  it("executes getLatestPosts", async () => {
    mockRedditService.getLatestPosts.mockResolvedValue({ data: { children: [] } });
    await getLatestPostsTool.execute({ subreddit: "programming", limit: 20 }, mockAgent);
    expect(mockRedditService.getLatestPosts).toHaveBeenCalledWith("programming", expect.objectContaining({ limit: 20 }));
  });
});

describe("Reddit plugin", () => {
  it("registers the service, tools, and commands on install", () => {
    const app = createTestingApp() as any;
    const addServicesSpy = mock();
    app.addServices = addServicesSpy;

    const waiters: Array<(service: unknown) => void> = [];
    app.waitForService = mock().mockImplementation((_type: unknown, callback: (service: unknown) => void) => {
      waiters.push(callback);
    });

    plugin.install(app);

    expect(addServicesSpy).toHaveBeenCalled();
    expect(addServicesSpy.mock.calls[0]![0]).toBeInstanceOf(RedditService);
    // AgentCommandService, ChatService, ScriptingService
    expect(waiters.length).toBe(3);
  });
});
