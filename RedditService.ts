import {TokenRingService} from "@tokenring-ai/agent/types";
import {doFetchWithRetry} from "@tokenring-ai/utility/doFetchWithRetry";
import {HttpService} from "@tokenring-ai/utility/HttpService";

export type RedditConfig = {
  baseUrl?: string;
};

export type RedditSearchOptions = {
  limit?: number;
  sort?: 'relevance' | 'hot' | 'top' | 'new' | 'comments';
  t?: 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';
  after?: string;
  before?: string;
};

export type RedditListingOptions = {
  limit?: number;
  after?: string;
  before?: string;
};

export default class RedditService extends HttpService implements TokenRingService {
  name = "RedditService";
  description = "Service for searching Reddit posts and retrieving content";
  
  protected baseUrl: string;
  protected defaultHeaders = {"User-Agent": "TokenRing-Writer/1.0 (https://github.com/tokenring/writer)"};

  constructor(config: RedditConfig = {}) {
    super();
    this.baseUrl = config.baseUrl || "https://www.reddit.com";
  }

  async searchSubreddit(subreddit: string, query: string, opts: RedditSearchOptions = {}): Promise<any> {
    if (!subreddit) throw new Error("subreddit is required");
    if (!query) throw new Error("query is required");

    const params = new URLSearchParams({
      q: query,
      restrict_sr: "true",
      limit: String(opts.limit || 25),
      sort: opts.sort || "relevance",
      ...(opts.t && { t: opts.t }),
      ...(opts.after && { after: opts.after }),
      ...(opts.before && { before: opts.before }),
    });

    return this.fetchJson(`/r/${subreddit}/search.json?${params}`, {method: "GET"}, "Reddit search");
  }

  async retrievePost(postUrl: string): Promise<any> {
    if (!postUrl) throw new Error("postUrl is required");

    // Ensure URL ends with .json
    const jsonUrl = postUrl.endsWith('.json') ? postUrl : `${postUrl}.json`;
    
    // For external URLs, we need to use the full URL
    const res = await doFetchWithRetry(jsonUrl, {
      method: "GET",
      headers: this.defaultHeaders,
    });
    return this.parseJsonOrThrow(res, "Reddit post retrieval");
  }

  async getLatestPosts(subreddit: string, opts: RedditListingOptions = {}): Promise<any> {
    if (!subreddit) throw new Error("subreddit is required");

    const params = new URLSearchParams({
      limit: String(opts.limit || 25),
      ...(opts.after && { after: opts.after }),
      ...(opts.before && { before: opts.before }),
    });

    return this.fetchJson(`/r/${subreddit}/new.json?${params}`, {method: "GET"}, "Reddit latest posts");
  }

}