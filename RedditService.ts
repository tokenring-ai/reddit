import {TokenRingService} from "@tokenring-ai/agent/types";
import {doFetchWithRetry} from "@tokenring-ai/utility/doFetchWithRetry";

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

export default class RedditService implements TokenRingService {
  name = "RedditService";
  description = "Service for searching Reddit posts and retrieving content";
  private readonly baseUrl: string;

  constructor(config: RedditConfig = {}) {
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

    const url = `${this.baseUrl}/r/${subreddit}/search.json?${params}`;

    const res = await doFetchWithRetry(url, {
      method: "GET",
      headers: {
        "User-Agent": "TokenRing-Writer/1.0 (https://github.com/tokenring/writer)",
      },
    });

    return await this.parseJsonOrThrow(res, "Reddit search");
  }

  async retrievePost(postUrl: string): Promise<any> {
    if (!postUrl) throw new Error("postUrl is required");

    // Ensure URL ends with .json
    const jsonUrl = postUrl.endsWith('.json') ? postUrl : `${postUrl}.json`;

    const res = await doFetchWithRetry(jsonUrl, {
      method: "GET",
      headers: {
        "User-Agent": "TokenRing-Writer/1.0 (https://github.com/tokenring/writer)",
      },
    });

    return await this.parseJsonOrThrow(res, "Reddit post retrieval");
  }

  async getLatestPosts(subreddit: string, opts: RedditListingOptions = {}): Promise<any> {
    if (!subreddit) throw new Error("subreddit is required");

    const params = new URLSearchParams({
      limit: String(opts.limit || 25),
      ...(opts.after && { after: opts.after }),
      ...(opts.before && { before: opts.before }),
    });

    const url = `${this.baseUrl}/r/${subreddit}/new.json?${params}`;

    const res = await doFetchWithRetry(url, {
      method: "GET",
      headers: {
        "User-Agent": "TokenRing-Writer/1.0 (https://github.com/tokenring/writer)",
      },
    });

    return await this.parseJsonOrThrow(res, "Reddit latest posts");
  }

  private async parseJsonOrThrow(res: Response, context: string): Promise<any> {
    const text = await res.text().catch(() => "");
    try {
      const json = text ? JSON.parse(text) : undefined;
      if (!res.ok) {
        throw Object.assign(new Error(`${context} failed (${res.status})`), {
          status: res.status,
          details: json ?? text?.slice(0, 500),
        });
      }
      return json;
    } catch (e: any) {
      if (res.ok) {
        return text;
      }
      if (!e.status) {
        throw Object.assign(new Error(`${context} failed (${res.status})`), {
          status: res.status,
          details: text?.slice(0, 500),
        });
      }
      throw e;
    }
  }
}