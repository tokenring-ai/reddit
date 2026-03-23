import {describe, expect, it, vi, beforeEach} from "vitest";
import RedditService from "../RedditService.js";
import {RedditConfigSchema} from "../schema.js";
import {doFetchWithRetry} from "@tokenring-ai/utility/http/doFetchWithRetry";

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
      .rejects.toThrow("Reddit search failed (500)");
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
});
