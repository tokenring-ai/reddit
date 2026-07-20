import type TokenRingApp from "@tokenring-ai/app";
import { ConfigurationError, type TokenRingService } from "@tokenring-ai/app/types";
import { BotService } from "@tokenring-ai/bot";
import { HTTPRetriever } from "@tokenring-ai/utility/http/HTTPRetriever";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import { deepEquals } from "bun";
import type { z } from "zod";
import RedditMessagingProvider from "./RedditMessagingProvider.ts";
import { RedditListingResponseSchema, type ResolvedRedditServiceConfig } from "./schema.ts";

export type RedditSearchOptions = {
  limit?: number | undefined;
  sort?: "relevance" | "hot" | "top" | "new" | "comments";
  t?: "hour" | "day" | "week" | "month" | "year" | "all";
  after?: string | undefined;
  before?: string | undefined;
};

export type RedditListingOptions = {
  limit?: number | undefined;
  after?: string | undefined;
  before?: string | undefined;
};

/**
 * Connects configured Reddit accounts to the bot service, and exposes public
 * research helpers (search / latest / retrieve) used by chat tools.
 */
export default class RedditService implements TokenRingService {
  readonly name = "RedditService";
  description = "Connects Reddit accounts to the bot service and provides research tools.";

  private providers = new KeyedRegistry<RedditMessagingProvider>();
  private options: ResolvedRedditServiceConfig = {
    accounts: {},
    publicBaseUrl: "https://www.reddit.com",
    userAgent: "TokenRing-One/1.0 (https://github.com/tokenring-ai/one)",
  };
  private publicRetriever: HTTPRetriever;

  getAvailableAccounts = this.providers.keysArray;
  getProvider = this.providers.get;

  constructor(private app: TokenRingApp) {
    this.publicRetriever = new HTTPRetriever({
      baseUrl: this.options.publicBaseUrl,
      headers: { "User-Agent": this.options.userAgent },
      timeout: 10_000,
    });
  }

  async reconfigure(options: ResolvedRedditServiceConfig): Promise<void> {
    this.publicRetriever = new HTTPRetriever({
      baseUrl: options.publicBaseUrl,
      headers: { "User-Agent": options.userAgent },
      timeout: 10_000,
    });

    const botService = this.requireBotServiceIfNeeded(options);

    await this.providers.reconcileAgainstAsync(options.accounts, {
      creating: async (accountName, accountConfig) => {
        this.app.serviceOutput(this, `Connecting Reddit account ${accountName}`);
        const provider = new RedditMessagingProvider(this.app, this, accountName, accountConfig);
        await provider.start();
        botService!.registerProvider(accountName, provider);
        return provider;
      },
      deleting: async (accountName, provider) => {
        this.app.serviceOutput(this, `Stopping Reddit account ${accountName}`);
        botService?.unregisterProvider(accountName);
        await provider.stop();
      },
      updating: async (accountName, provider, accountConfig) => {
        if (deepEquals(this.options.accounts[accountName], accountConfig, true)) return provider;

        this.app.serviceOutput(this, `Reconnecting Reddit account ${accountName}`);
        botService?.unregisterProvider(accountName);
        await provider.stop();

        const next = new RedditMessagingProvider(this.app, this, accountName, accountConfig);
        await next.start();
        botService!.registerProvider(accountName, next);
        return next;
      },
    });

    this.options = options;
  }

  async stop(): Promise<void> {
    const botService = this.app.getService(BotService);
    for (const [accountName, provider] of this.providers.entriesArray()) {
      botService?.unregisterProvider(accountName);
      await provider.stop();
      this.providers.unregister(accountName);
    }
  }

  // --- Research tools (public JSON API; no account required) ---

  searchSubreddit(subreddit: string, query: string, opts: RedditSearchOptions = {}): Promise<z.output<typeof RedditListingResponseSchema>> {
    if (!subreddit) throw new Error("subreddit is required");
    if (!query) throw new Error("query is required");

    const params = new URLSearchParams({
      q: query,
      restrict_sr: "true",
      limit: String(opts.limit || 25),
      sort: opts.sort || "relevance",
      raw_json: "1",
      ...(opts.t && { t: opts.t }),
      ...(opts.after && { after: opts.after }),
      ...(opts.before && { before: opts.before }),
    });

    return this.publicRetriever.fetchValidatedJson({
      url: `/r/${subreddit}/search.json?${params}`,
      opts: { method: "GET" },
      schema: RedditListingResponseSchema,
      context: "Reddit search",
    });
  }

  async retrievePost(postUrl: string) {
    if (!postUrl) throw new Error("postUrl is required");
    const jsonUrl = postUrl.endsWith(".json") ? postUrl : `${postUrl}.json`;
    return this.publicRetriever.fetchJson({
      url: jsonUrl,
      context: "Reddit post retrieval",
    });
  }

  getLatestPosts(subreddit: string, opts: RedditListingOptions = {}): Promise<z.output<typeof RedditListingResponseSchema>> {
    if (!subreddit) throw new Error("subreddit is required");

    const params = new URLSearchParams({
      limit: String(opts.limit || 25),
      raw_json: "1",
      ...(opts.after && { after: opts.after }),
      ...(opts.before && { before: opts.before }),
    });

    return this.publicRetriever.fetchValidatedJson({
      url: `/r/${subreddit}/new.json?${params}`,
      opts: { method: "GET" },
      schema: RedditListingResponseSchema,
      context: "Reddit latest posts",
    });
  }

  private requireBotServiceIfNeeded(options: ResolvedRedditServiceConfig): BotService | undefined {
    if (Object.keys(options.accounts).length === 0) return undefined;
    const botService = this.app.getService(BotService);
    if (!botService) {
      throw new ConfigurationError(
        this.name,
        "Reddit accounts are configured but the @tokenring-ai/bot plugin is not installed, so there is nothing to connect them to",
      );
    }
    return botService;
  }
}
