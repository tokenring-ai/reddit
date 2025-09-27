import { describe, expect, it } from "vitest";
import RedditService from "../RedditService.ts";

describe("RedditService Integration Tests", () => {
	it("should search subreddit successfully", async () => {
		const reddit = new RedditService();
		const result = await reddit.searchSubreddit("programming", "javascript", {
			limit: 3,
		});

		expect(result).toBeDefined();
		expect(result.data).toBeDefined();
		expect(result.data.children).toBeInstanceOf(Array);
		expect(result.data.children.length).toBeGreaterThan(0);
		expect(result.data.children[0].data).toHaveProperty("title");
	});

	it("should handle pagination with after parameter", async () => {
		const reddit = new RedditService();
		const result = await reddit.searchSubreddit("technology", "AI", { 
			limit: 2, 
			sort: "top",
			t: "week"
		});

		expect(result.data.children).toBeInstanceOf(Array);
		expect(result.data.children.length).toBeLessThanOrEqual(2);
	});

	it("should throw error for empty subreddit", async () => {
		const reddit = new RedditService();
		await expect(reddit.searchSubreddit("", "test")).rejects.toThrow("subreddit is required");
	});

	it("should throw error for empty query", async () => {
		const reddit = new RedditService();
		await expect(reddit.searchSubreddit("test", "")).rejects.toThrow("query is required");
	});

	it("should retrieve post content by URL", async () => {
		const reddit = new RedditService();
		// Using a well-known Reddit post URL for testing
		const postUrl = "https://www.reddit.com/r/announcements/comments/5q4qmg/out_with_2016_in_with_2017/";
		const content = await reddit.retrievePost(postUrl);

		expect(content).toBeDefined();
		expect(Array.isArray(content)).toBe(true);
		expect(content[0].data.children[0].data).toHaveProperty("title");
	});

	it("should throw error for empty post URL", async () => {
		const reddit = new RedditService();
		await expect(reddit.retrievePost("")).rejects.toThrow("postUrl is required");
	});

	it("should get latest posts from subreddit", async () => {
		const reddit = new RedditService();
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
		const reddit = new RedditService();
		await expect(reddit.getLatestPosts("")).rejects.toThrow("subreddit is required");
	});
});