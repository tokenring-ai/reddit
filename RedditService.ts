import type TokenRingApp from "@tokenring-ai/app";
import { ConfigurationError, type TokenRingService } from "@tokenring-ai/app/types";
import { BotService } from "@tokenring-ai/bot";
import { HTTPRetriever } from "@tokenring-ai/utility/http/HTTPRetriever";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import { deepEquals } from "bun";
import type { z } from "zod";
import ProviderStateFile from "./ProviderStateFile.ts";
import RedditMessagingProvider, { type RedditInboxStateFile, RedditInboxStateSchema, type RedditSelfPost } from "./RedditMessagingProvider.ts";
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
 * research helpers (search / latest / retrieve) plus self-post submission.
 */
export default class RedditService implements TokenRingService {
  readonly name = "RedditService";
  description = "Connects Reddit accounts to the bot service and provides research and posting tools.";

  private providers = new KeyedRegistry<RedditMessagingProvider>();
  /**
   * The account config each live provider was started with. Reconciles compare against this
   * (not the last fully applied options), so a change that failed part-way is retried and a
   * revert to the running config is a no-op.
   */
  private providerConfigs = new Map<string, ResolvedRedditServiceConfig["accounts"][string]>();
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
        const provider = new RedditMessagingProvider(this.app, this, accountName, accountConfig, this.inboxStateFile(accountName));
        await provider.start();
        botService!.registerProvider(accountName, provider);
        this.providerConfigs.set(accountName, accountConfig);
        return provider;
      },
      deleting: async (accountName, provider) => {
        this.app.serviceOutput(this, `Stopping Reddit account ${accountName}`);
        botService?.unregisterProvider(accountName);
        this.providerConfigs.delete(accountName);
        await provider.stop();
      },
      updating: async (accountName, provider, accountConfig) => {
        if (deepEquals(this.providerConfigs.get(accountName), accountConfig, true)) return provider;

        // Start the replacement first: if it fails, the current provider stays registered and
        // running, and the error propagates to the caller.
        this.app.serviceOutput(this, `Reconnecting Reddit account ${accountName}`);
        const next = new RedditMessagingProvider(this.app, this, accountName, accountConfig, this.inboxStateFile(accountName));
        await next.start();

        botService!.unregisterProvider(accountName);
        botService!.registerProvider(accountName, next);
        this.providerConfigs.set(accountName, accountConfig);
        try {
          await provider.stop();
        } catch (error: unknown) {
          this.app.serviceError(this, `Error stopping replaced Reddit account ${accountName}:`, error);
        }
        return next;
      },
    });

    this.options = options;
  }

  async stop(): Promise<void> {
    const botService = this.app.getService(BotService);
    for (const [accountName, provider] of this.providers.entriesArray()) {
      botService?.unregisterProvider(accountName);
      this.providers.unregister(accountName);
      this.providerConfigs.delete(accountName);
      await provider.stop();
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
    // Only Reddit itself: the URL can come from content the model read, and the retriever would
    // otherwise fetch any host the server can reach and hand back its response.
    let parsed: URL;
    try {
      parsed = new URL(postUrl);
    } catch {
      throw new Error(`Not a URL: ${postUrl}`);
    }
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:" || !(host === "reddit.com" || host.endsWith(".reddit.com"))) {
      throw new Error(`Only https://reddit.com post URLs can be retrieved, not ${parsed.origin}`);
    }
    // The path alone, resolved against the Reddit API base. A path starting `//` (which is also
    // what `/\host` parses to) would resolve as a protocol-relative URL to another host.
    const pathname = parsed.pathname;
    if (pathname.startsWith("//") || pathname.includes("\\") || /^\/*[a-z][a-z0-9+.-]*:/i.test(pathname)) {
      throw new Error(`Not a Reddit post path: ${pathname}`);
    }
    const jsonPath = pathname.endsWith(".json") ? pathname : `${pathname.replace(/\/$/, "")}.json`;
    const target = new URL(jsonPath, this.options.publicBaseUrl);
    const targetHost = target.hostname.toLowerCase();
    if (target.protocol !== "https:" || !(targetHost === "reddit.com" || targetHost.endsWith(".reddit.com"))) {
      throw new Error(`Only https://reddit.com post URLs can be retrieved, not ${target.origin}`);
    }
    return this.publicRetriever.fetchJson({
      url: target,
      context: "Reddit post retrieval",
    });
  }

  /** Where an account's inbox state is kept between runs. */
  private inboxStateFile(accountName: string): RedditInboxStateFile {
    return new ProviderStateFile(this.app.getWorkspaceResolvedPath(`bot-state/reddit/${encodeURIComponent(accountName)}.json`), RedditInboxStateSchema);
  }

  /**
   * Picks the connected account a post should come from. A single connected
   * account is used when the caller does not name one.
   */
  resolveAccountName(accountName?: string): string {
    const names = this.providers.keysArray();
    if (accountName) {
      if (!this.providers.get(accountName)) {
        throw new Error(`Reddit account "${accountName}" is not connected. Connected accounts: ${names.join(", ") || "(none)"}`);
      }
      return accountName;
    }
    if (names.length === 1) return names[0]!;
    if (names.length === 0) throw new Error("No Reddit account is connected");
    throw new Error(`Multiple Reddit accounts are connected (${names.join(", ")}). Pass an account name.`);
  }

  /** Publishes a self post through the named account's existing OAuth client. */
  async submitSelfPost(subreddit: string, title: string, text: string, accountName?: string): Promise<RedditSelfPost> {
    const sr = subreddit
      .trim()
      .replace(/^\/?r\//i, "")
      .trim();
    const postTitle = title.trim();
    const body = text.trim();
    if (!sr) throw new Error("subreddit is required");
    if (!postTitle) throw new Error("title is required");
    if (!body) throw new Error("text is required");

    const account = this.resolveAccountName(accountName);
    return this.providers.require(account).submitSelfPost(sr, postTitle, body);
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
