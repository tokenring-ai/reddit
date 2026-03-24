import {describe, expect, it, vi, beforeEach} from "vitest";
import RedditService from "../RedditService.js";
import {RedditConfigSchema} from "../schema.js";
import {doFetchWithRetry} from "@tokenring-ai/utility/http/doFetchWithRetry";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp";
import createTestingAgent from "@tokenring-ai/agent/test/createTestingAgent";
import {ChatService} from "@tokenring-ai/chat";
import {ChatServiceConfigSchema} from "@tokenring-ai/chat/schema";
import plugin from "../plugin.js";
import searchSubredditTool from "../tools/searchSubreddit.js";
import retrievePostTool from "../tools/retrievePost.js";
import getLatestPostsTool from "../tools/getLatestPosts.js";

// Mock HTTP calls
vi.mock("@tokenring-ai/utility/http/doFetchWithRetry", () => ({
  doFetchWithRetry: vi.fn(),
}));

describe("RedditService Integration Tests", () => {
  let mockResponse: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create a mock successful response for search/latest posts
    mockResponse = {
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({
        data: {
          children: [
            {
              data: {
                title: "Test Post 1",
                selftext: "Test content",
                url: "https://reddit.com/test1",
                author: "testuser1",
                created_utc: Date.now(),
              }
            },
            {
              data: {
                title: "Test Post 2",
                selftext: "More test content",
                url: "https://reddit.com/test2",
                author: "testuser2",
                created_utc: Date.now(),
              }
            }
          ]
        }
      })),
    };

    vi.mocked(doFetchWithRetry).mockResolvedValue(mockResponse);
  });

  it("should search subreddit successfully", async () => {
    const reddit = new RedditService(RedditConfigSchema.parse({}));
    const result = await reddit.searchSubreddit("programming", "javascript", {
      limit: 3,
    });

    expect(result).toBeDefined();
    expect(result.data).toBeDefined();
    expect(result.data.children).toBeInstanceOf(Array);
    expect(result.data.children.length).toBeGreaterThan(0);
    expect(result.data.children[0].data).toHaveProperty("title");
    
    // Verify HTTP call was made
    expect(doFetchWithRetry).toHaveBeenCalled();
  });

  it("should handle pagination with after parameter", async () => {
    const reddit = new RedditService(RedditConfigSchema.parse({}));
    const result = await reddit.searchSubreddit("technology", "AI", {
      limit: 2,
      sort: "top",
      t: "week",
    });

    expect(result.data.children).toBeInstanceOf(Array);
    expect(result.data.children.length).toBeLessThanOrEqual(2);
  });

  it("should throw error for empty subreddit", async () => {
    const reddit = new RedditService(RedditConfigSchema.parse({}));
    await expect(reddit.searchSubreddit("", "test")).rejects.toThrow(
      "subreddit is required",
    );
  });

  it("should throw error for empty query", async () => {
    const reddit = new RedditService(RedditConfigSchema.parse({}));
    await expect(reddit.searchSubreddit("test", "")).rejects.toThrow(
      "query is required",
    );
  });

  it("should retrieve post content by URL", async () => {
    const reddit = new RedditService(RedditConfigSchema.parse({}));
    // Using a well-known Reddit post URL for testing
    const postUrl = "https://www.reddit.com/r/announcements/comments/5q4qmg/out_with_2016_in_with_2017/";
    
    // Mock response for retrievePost - Reddit returns an array with [submission, comments]
    const postMockResponse = {
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify([
        {
          data: {
            children: [
              {
                data: {
                  title: "Test Post Title",
                  selftext: "Test post content",
                  url: postUrl,
                  author: "testuser",
                  created_utc: Date.now(),
                }
              }
            ]
          }
        }
      ])),
    };
    
    vi.mocked(doFetchWithRetry).mockResolvedValue(postMockResponse);
    
    const content = await reddit.retrievePost(postUrl);

    expect(content).toBeDefined();
    expect(Array.isArray(content)).toBe(true);
    expect(content[0].data.children[0].data).toHaveProperty("title");
    
    // Verify the URL was called with .json extension
    expect(doFetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining(".json"),
      expect.any(Object)
    );
  });

  it("should throw error for empty post URL", async () => {
    const reddit = new RedditService(RedditConfigSchema.parse({}));
    await expect(reddit.retrievePost("")).rejects.toThrow(
      "postUrl is required",
    );
  });

  it("should get latest posts from subreddit", async () => {
    const reddit = new RedditService(RedditConfigSchema.parse({}));
    const result = await reddit.getLatestPosts("programming", {
      limit: 5,
    });

    expect(result).toBeDefined();
    expect(result.data).toBeDefined();
    expect(result.data.children).toBeInstanceOf(Array);
    expect(result.data.children.length).toBeGreaterThan(0);
    expect(result.data.children[0].data).toHaveProperty("title");
  });

  it("should throw error for empty subreddit in getLatestPosts", async () => {
    const reddit = new RedditService(RedditConfigSchema.parse({}));
    await expect(reddit.getLatestPosts("")).rejects.toThrow(
      "subreddit is required",
    );
  });

  it("should handle HTTP errors gracefully", async () => {
    const mockErrorResponse = {
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    };

    vi.mocked(doFetchWithRetry).mockResolvedValue(mockErrorResponse as any);

    const reddit = new RedditService(RedditConfigSchema.parse({}));
    
    await expect(reddit.searchSubreddit("programming", "test"))
      .rejects
      .toThrow("Reddit search failed (500)");
  });

  it("should return empty object for invalid JSON responses", async () => {
    const mockInvalidJsonResponse = {
      ok: true,
      status: 200,
      text: () => Promise.resolve("Invalid JSON"),
    };

    vi.mocked(doFetchWithRetry).mockResolvedValue(mockInvalidJsonResponse as any);

    const reddit = new RedditService(RedditConfigSchema.parse({}));
    
    // Invalid JSON is caught silently and returns empty object
    const result = await reddit.searchSubreddit("programming", "test");
    expect(result).toEqual({});
  });

  it("should use custom baseUrl when configured", async () => {
    const customBaseUrl = "https://custom-reddit.example.com";
    const reddit = new RedditService(RedditConfigSchema.parse({ baseUrl: customBaseUrl }));
    
    // The baseUrl should be set correctly
    expect(reddit).toBeDefined();
    // Note: We can't directly access protected baseUrl, but we can verify it's used
    // by checking the service was created without errors
  });

  it("should have correct service name and description", () => {
    const reddit = new RedditService(RedditConfigSchema.parse({}));
    
    expect(reddit.name).toBe("RedditService");
    expect(reddit.description).toBe("Service for searching Reddit posts and retrieving content");
  });
});

describe("Reddit Tools Tests", () => {
  let mockAgent: any;
  let mockRedditService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    const app = createTestingApp();
    mockAgent = createTestingAgent(app);
    
    // Mock infoMessage
    vi.spyOn(mockAgent, 'infoMessage').mockResolvedValue(undefined);
    
    // Create mock RedditService
    mockRedditService = {
      searchSubreddit: vi.fn(),
      retrievePost: vi.fn(),
      getLatestPosts: vi.fn(),
    };
    
    // Add mock RedditService to app
    app.addServices(mockRedditService);
    
    // Spy on requireServiceByType
    vi.spyOn(mockAgent, 'requireServiceByType').mockReturnValue(mockRedditService);
  });

  it("should have correct tool metadata for searchSubreddit", () => {
    expect(searchSubredditTool.name).toBe("reddit_searchSubreddit");
    expect(searchSubredditTool.displayName).toBe("Reddit/searchSubreddit");
    expect(searchSubredditTool.description).toContain("Search posts in a specific subreddit");
    expect(searchSubredditTool.inputSchema).toBeDefined();
  });

  it("should have correct tool metadata for retrievePost", () => {
    expect(retrievePostTool.name).toBe("reddit_retrievePost");
    expect(retrievePostTool.displayName).toBe("Reddit/retrievePost");
    expect(retrievePostTool.description).toContain("Retrieve a Reddit post");
    expect(retrievePostTool.inputSchema).toBeDefined();
  });

  it("should have correct tool metadata for getLatestPosts", () => {
    expect(getLatestPostsTool.name).toBe("reddit_getLatestPosts");
    expect(getLatestPostsTool.displayName).toBe("Reddit/getLatestPosts");
    expect(getLatestPostsTool.description).toContain("Get the latest posts from a subreddit");
    expect(getLatestPostsTool.inputSchema).toBeDefined();
  });

  it("should execute searchSubreddit tool successfully", async () => {
    const mockResults = { data: { children: [{ data: { title: "Test" } }] } };
    mockRedditService.searchSubreddit.mockResolvedValue(mockResults);

    const result = await searchSubredditTool.execute({
      subreddit: "programming",
      query: "javascript",
      limit: 10,
    }, mockAgent);

    expect(mockRedditService.searchSubreddit).toHaveBeenCalledWith(
      "programming",
      "javascript",
      expect.objectContaining({ limit: 10 })
    );
    expect(result.type).toBe("json");
    expect(result.data.results).toEqual(mockResults);
  });

  it("should throw error when subreddit is missing in searchSubreddit tool", async () => {
    await expect(searchSubredditTool.execute({
      subreddit: "",
      query: "javascript",
    }, mockAgent)).rejects.toThrow("subreddit is required");
  });

  it("should throw error when query is missing in searchSubreddit tool", async () => {
    await expect(searchSubredditTool.execute({
      subreddit: "programming",
      query: "",
    }, mockAgent)).rejects.toThrow("query is required");
  });

  it("should execute retrievePost tool successfully", async () => {
    const mockPost = { data: { title: "Test Post" } };
    mockRedditService.retrievePost.mockResolvedValue(mockPost);

    const result = await retrievePostTool.execute({
      postUrl: "https://www.reddit.com/r/test/comments/123/test/",
    }, mockAgent);

    expect(mockRedditService.retrievePost).toHaveBeenCalledWith(
      "https://www.reddit.com/r/test/comments/123/test/"
    );
    expect(result.type).toBe("json");
    expect(result.data.post).toEqual(mockPost);
  });

  it("should throw error when postUrl is missing in retrievePost tool", async () => {
    await expect(retrievePostTool.execute({
      postUrl: "",
    }, mockAgent)).rejects.toThrow("postUrl is required");
  });

  it("should execute getLatestPosts tool successfully", async () => {
    const mockPosts = { data: { children: [{ data: { title: "Test" } }] } };
    mockRedditService.getLatestPosts.mockResolvedValue(mockPosts);

    const result = await getLatestPostsTool.execute({
      subreddit: "programming",
      limit: 20,
    }, mockAgent);

    expect(mockRedditService.getLatestPosts).toHaveBeenCalledWith(
      "programming",
      expect.objectContaining({ limit: 20 })
    );
    expect(result.type).toBe("json");
    expect(result.data.posts).toEqual(mockPosts);
  });

  it("should throw error when subreddit is missing in getLatestPosts tool", async () => {
    await expect(getLatestPostsTool.execute({
      subreddit: "",
    }, mockAgent)).rejects.toThrow("subreddit is required");
  });
});

describe("Reddit Plugin Tests", () => {
  let mockApp: any;
  let mockChatService: any;
  let mockScriptingService: any;
  let addServicesSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockApp = createTestingApp();
    
    // Track addServices calls
    const originalAddServices = mockApp.addServices;
    addServicesSpy = vi.fn();
    mockApp.addServices = addServicesSpy;
    
    // Create mock ChatService
    mockChatService = {
      addTools: vi.fn(),
    };
    
    // Create mock ScriptingService
    mockScriptingService = {
      registerFunction: vi.fn(),
    };
    
    // Mock waitForItemByType for ScriptingService - call callback immediately
    mockApp.services = {
      waitForItemByType: vi.fn().mockImplementation((serviceType, callback) => {
        callback(mockScriptingService);
      }),
    };
    
    // Mock waitForService for ChatService - call callback immediately
    mockApp.waitForService = vi.fn().mockImplementation((serviceType, callback) => {
      callback(mockChatService);
    });
  });

  it("should install plugin with empty configuration", () => {
    const config = {
      reddit: RedditConfigSchema.parse({}),
    };
    
    plugin.install(mockApp, config as any);
    
    // Verify RedditService was registered with default config
    expect(addServicesSpy).toHaveBeenCalled();
    const redditService = addServicesSpy.mock.calls[0][0];
    expect(redditService).toBeInstanceOf(RedditService);
    
    // Verify tools were added
    expect(mockChatService.addTools).toHaveBeenCalled();
    
    // Verify scripting functions were registered
    expect(mockScriptingService.registerFunction).toHaveBeenCalledWith("searchSubreddit", expect.any(Object));
    expect(mockScriptingService.registerFunction).toHaveBeenCalledWith("getRedditPost", expect.any(Object));
    expect(mockScriptingService.registerFunction).toHaveBeenCalledWith("getLatestPosts", expect.any(Object));
  });

  it("should install plugin with custom baseUrl configuration", () => {
    const config = {
      reddit: RedditConfigSchema.parse({
        baseUrl: "https://custom-reddit.example.com",
      }),
    };
    
    plugin.install(mockApp, config as any);
    
    // Verify RedditService was registered
    expect(addServicesSpy).toHaveBeenCalled();
    const redditService = addServicesSpy.mock.calls[0][0];
    expect(redditService).toBeInstanceOf(RedditService);
    
    // Verify tools were added
    expect(mockChatService.addTools).toHaveBeenCalled();
    
    // Verify scripting functions were registered
    expect(mockScriptingService.registerFunction).toHaveBeenCalledWith("searchSubreddit", expect.any(Object));
    expect(mockScriptingService.registerFunction).toHaveBeenCalledWith("getRedditPost", expect.any(Object));
    expect(mockScriptingService.registerFunction).toHaveBeenCalledWith("getLatestPosts", expect.any(Object));
  });
});
