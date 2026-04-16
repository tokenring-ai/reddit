import type {TokenRingPlugin} from "@tokenring-ai/app";
import {ChatService} from "@tokenring-ai/chat";
import {ScriptingService} from "@tokenring-ai/scripting";
import type {ScriptingThis} from "@tokenring-ai/scripting/ScriptingService";
import {z} from "zod";
import {SocialMediaService} from "../social/index.ts";
import packageJSON from "./package.json" with {type: "json"};
import RedditService from "./RedditService.ts";
import RedditSocialMediaProvider from "./RedditSocialMediaProvider.ts";
import {type ParsedRedditAccount, RedditAccountSchema, RedditConfigSchema} from "./schema.ts";
import tools from "./tools.ts";

const packageConfigSchema = z.object({
  reddit: RedditConfigSchema.prefault({accounts: {}}),
});

function addAccountsFromEnv(
  accounts: Record<string, Partial<ParsedRedditAccount>>,
) {
  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^REDDIT_CLIENT_ID(\d*)$/);
    if (!match || !value) continue;
    const n = match[1];
    const clientSecret = process.env[`REDDIT_CLIENT_SECRET${n}`];
    if (!clientSecret) continue;
    const name =
      process.env[`REDDIT_ACCOUNT_NAME${n}`] ?? `Reddit${n ? ` ${n}` : ""}`;
    accounts[name] = {
      clientId: value,
      clientSecret,
      username: process.env[`REDDIT_USERNAME${n}`],
      refreshToken: process.env[`REDDIT_REFRESH_TOKEN${n}`],
      accessToken: process.env[`REDDIT_ACCESS_TOKEN${n}`],
      defaultSubreddit: process.env[`REDDIT_DEFAULT_SUBREDDIT${n}`],
      social: !!process.env[`REDDIT_SOCIAL${n}`],
    };
  }
}

export default {
  name: packageJSON.name,
  displayName: "Reddit Integration",
  version: packageJSON.version,
  description: packageJSON.description,
  install(app, config) {
    addAccountsFromEnv(config.reddit.accounts);
    if (Object.keys(config.reddit.accounts).length === 0) return;

    app.services.waitForItemByType(
      ScriptingService,
      (scriptingService: ScriptingService) => {
        scriptingService.registerFunction("searchSubreddit", {
          type: "native",
          params: ["subreddit", "query"],
          async execute(
            this: ScriptingThis,
            subreddit: string,
            query: string,
          ): Promise<string> {
            const result = await this.agent
              .requireServiceByType(RedditService)
              .searchSubreddit(subreddit, query);
            return JSON.stringify(result.data.children);
          },
        });

        scriptingService.registerFunction("getRedditPost", {
          type: "native",
          params: ["url"],
          async execute(this: ScriptingThis, url: string): Promise<string> {
            const result = await this.agent
              .requireServiceByType(RedditService)
              .retrievePost(url);
            return JSON.stringify(result);
          },
        });

        scriptingService.registerFunction("getLatestPosts", {
          type: "native",
          params: ["subreddit"],
          async execute(
            this: ScriptingThis,
            subreddit: string,
          ): Promise<string> {
            const result = await this.agent
              .requireServiceByType(RedditService)
              .getLatestPosts(subreddit);
            return JSON.stringify(result.data.children);
          },
        });
      },
    );

    app.waitForService(ChatService, (chatService) =>
      chatService.addTools(...tools),
    );

    const [, defaultAccount] = Object.entries(config.reddit.accounts)[0];
    const parsedDefault = RedditAccountSchema.parse(defaultAccount);
    const redditService = new RedditService(parsedDefault);
    app.addServices(redditService);

    app.services.waitForItemByType(SocialMediaService, (socialService) => {
      for (const [name, account] of Object.entries(config.reddit.accounts)) {
        if (account.social) {
          const parsed = RedditAccountSchema.parse(account);
          socialService.registerSocialMediaProvider(
            name,
            new RedditSocialMediaProvider(redditService, parsed),
          );
        }
      }
    });
  },
  config: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
