import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type Agent from "@tokenring-ai/agent/Agent";
import createTestingAgent from "@tokenring-ai/agent/test/createTestingAgent.test";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import { BotService } from "@tokenring-ai/bot";
import ChatService, { type CheckToolApprovalOptions } from "@tokenring-ai/chat/ChatService";
import { doFetchWithRetry } from "@tokenring-ai/utility/http/doFetchWithRetry";
import plugin from "../plugin.ts";
import RedditService from "../RedditService.ts";
import { RedditAccountConfigSchema, type ResolvedRedditAccountConfig } from "../schema.ts";
import getLatestPostsTool from "../tools/getLatestPosts.ts";
import retrievePostTool from "../tools/retrievePost.ts";
import searchSubredditTool from "../tools/searchSubreddit.ts";
import submitPostTool from "../tools/submitPost.ts";

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
    app.addService(RedditService, mockRedditService as RedditService);
    spyOn(mockAgent, "requireService").mockReturnValue(mockRedditService);
  });

  it("exposes tool metadata", () => {
    expect(searchSubredditTool.name).toBe("reddit_searchSubreddit");
    expect(retrievePostTool.name).toBe("reddit_retrievePost");
    expect(getLatestPostsTool.name).toBe("reddit_getLatestPosts");
    expect(submitPostTool.name).toBe("reddit_submitPost");
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
    const addServiceSpy = mock();
    app.addService = addServiceSpy;

    const waiters: Array<(service: unknown) => void> = [];
    app.waitForService = mock().mockImplementation((_type: unknown, callback: (service: unknown) => void) => {
      waiters.push(callback);
    });

    plugin.install(app);

    expect(addServiceSpy).toHaveBeenCalled();
    expect(addServiceSpy.mock.calls[0]![0]).toBe(RedditService);
    expect(addServiceSpy.mock.calls[0]![1]).toBeInstanceOf(RedditService);
    // AgentCommandService, ChatService, ScriptingService
    expect(waiters.length).toBe(3);
  });
});

describe("Reddit self posts", () => {
  let reddit: RedditService | undefined;

  afterEach(async () => {
    await reddit?.stop();
    reddit = undefined;
    // Drop the URL-routed fetch stub so it cannot leak into other test files.
    fetchMock().mockReset();
  });

  function fetchMock() {
    return doFetchWithRetry as ReturnType<typeof mock>;
  }

  function jsonResponse(data: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(data)),
    } as Response;
  }

  function parsedAccount(): ResolvedRedditAccountConfig {
    const base = RedditAccountConfigSchema.parse({ accessToken: "secret-token" });
    const { accessToken: _accessToken, refreshToken: _refreshToken, clientSecret: _clientSecret, ...rest } = base;
    return { ...rest, accessToken: "secret-token" };
  }

  function submitCalls() {
    return fetchMock().mock.calls.filter(call => String(call[0]).includes("/api/submit"));
  }

  function agentFor(service: RedditService, approve: boolean) {
    const checkToolApproval = mock(async (_request: CheckToolApprovalOptions, _agent: Agent) => approve);
    const services = new Map<unknown, unknown>([
      [RedditService, service],
      [ChatService, { checkToolApproval }],
    ]);
    const agent = {
      infoMessage: mock(),
      requireService: (cls: unknown) => {
        const serviceImpl = services.get(cls);
        if (!serviceImpl) throw new Error("service not stubbed");
        return serviceImpl;
      },
    } as unknown as Agent;
    return { agent, checkToolApproval };
  }

  async function connect(accounts: Record<string, ResolvedRedditAccountConfig> = { reddit: parsedAccount() }) {
    const app = createTestingApp();
    app.addService(BotService, {
      registerProvider() {},
      unregisterProvider() {},
    } as unknown as BotService);

    fetchMock().mockReset();
    fetchMock().mockImplementation(async (url: string | URL) => {
      const href = String(url);
      if (href.includes("/api/v1/me")) return jsonResponse({ id: "t2_abc", name: "tokenring" });
      if (href.includes("/message/")) return jsonResponse({ data: { children: [] } });
      if (href.includes("/api/submit")) {
        return jsonResponse({
          json: {
            errors: [],
            data: { id: "abc", name: "t3_abc", url: "https://www.reddit.com/r/programming/comments/abc/hello/" },
          },
        });
      }
      throw new Error(`unexpected Reddit request ${href}`);
    });

    reddit = new RedditService(app);
    await reddit.reconfigure({
      accounts,
      publicBaseUrl: "https://www.reddit.com",
      userAgent: "test-agent",
    });
    return reddit;
  }

  it("rejects empty subreddit, title, or text before any request", async () => {
    fetchMock().mockReset();
    const service = new RedditService(createTestingApp());
    await expect(service.submitSelfPost(" r/ ", "Title", "Body")).rejects.toThrow(/subreddit is required/);
    await expect(service.submitSelfPost("programming", " ", "Body")).rejects.toThrow(/title is required/);
    await expect(service.submitSelfPost("programming", "Title", " ")).rejects.toThrow(/text is required/);
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it("posts through the connected account's OAuth client", async () => {
    const service = await connect();
    const post = await service.submitSelfPost("r/programming", "Hello", "Body text");
    expect(post).toEqual({
      id: "abc",
      name: "t3_abc",
      url: "https://www.reddit.com/r/programming/comments/abc/hello/",
    });
    expect(submitCalls()).toHaveLength(1);
    const [, opts] = submitCalls()[0]!;
    expect(opts).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer secret-token" }),
      }),
    );
    const params = new URLSearchParams(String((opts as { body?: unknown }).body));
    expect(params.get("kind")).toBe("self");
    expect(params.get("sr")).toBe("programming");
    expect(params.get("title")).toBe("Hello");
    expect(params.get("text")).toBe("Body text");
  });

  it("reddit_submitPost posts only after approval", async () => {
    const service = await connect();
    const { agent, checkToolApproval } = agentFor(service, true);
    const result = await submitPostTool.execute({ subreddit: "r/programming", title: "Hello", text: "Body text" }, agent);

    expect(checkToolApproval).toHaveBeenCalledTimes(1);
    expect(checkToolApproval.mock.calls[0]?.[0]).toMatchObject({
      toolName: "reddit_submitPost",
      default: false,
      safetyLevel: 7,
    });
    expect(String(checkToolApproval.mock.calls[0]![0].detailedDescription)).toContain("Body text");
    expect(result.result).toContain("https://www.reddit.com/r/programming/comments/abc/hello/");
    expect(submitCalls()).toHaveLength(1);
  });

  it("declined approval does not post", async () => {
    const service = await connect();
    const { agent, checkToolApproval } = agentFor(service, false);

    await expect(submitPostTool.execute({ subreddit: "programming", title: "Hello", text: "Body text" }, agent)).rejects.toThrow(/did not approve/);
    expect(checkToolApproval).toHaveBeenCalledTimes(1);
    expect(submitCalls()).toHaveLength(0);
  });

  it("does not ask for approval or post when the subreddit, title, or text is empty", async () => {
    const service = await connect();
    const { agent, checkToolApproval } = agentFor(service, true);

    await expect(submitPostTool.execute({ subreddit: " ", title: "Hello", text: "Body" }, agent)).rejects.toThrow(/subreddit is required/);
    await expect(submitPostTool.execute({ subreddit: "programming", title: " ", text: "Body" }, agent)).rejects.toThrow(/title is required/);
    await expect(submitPostTool.execute({ subreddit: "programming", title: "Hello", text: " \n " }, agent)).rejects.toThrow(/text is required/);
    await expect(submitPostTool.execute({ subreddit: "programming", title: "t".repeat(301), text: "Body" }, agent)).rejects.toThrow(/300 characters/);
    expect(checkToolApproval).not.toHaveBeenCalled();
    expect(submitCalls()).toHaveLength(0);
  });

  it("requires an account name when more than one is connected and does not post until one is given", async () => {
    const service = await connect({ primary: parsedAccount(), support: parsedAccount() });
    const { agent, checkToolApproval } = agentFor(service, true);

    await expect(submitPostTool.execute({ subreddit: "programming", title: "Hello", text: "Body" }, agent)).rejects.toThrow(/Multiple Reddit accounts/);
    expect(checkToolApproval).not.toHaveBeenCalled();
    expect(submitCalls()).toHaveLength(0);

    const result = await submitPostTool.execute({ subreddit: "programming", title: "Hello", text: "Body", account: "support" }, agent);
    expect(result.result).toContain("as support");
    expect(submitCalls()).toHaveLength(1);
  });
});
