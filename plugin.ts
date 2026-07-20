import { AgentCommandService } from "@tokenring-ai/agent";
import type { TokenRingPlugin } from "@tokenring-ai/app";
import { ChatService } from "@tokenring-ai/chat";
import { ScriptingService } from "@tokenring-ai/scripting";
import type { ScriptingThis } from "@tokenring-ai/scripting/ScriptingService";
import { resolveSecret } from "@tokenring-ai/secrets/SecretService";
import { z } from "zod";
import agentCommands from "./commands.ts";
import packageJSON from "./package.json" with { type: "json" };
import RedditService from "./RedditService.ts";
import { RedditServiceConfigSchema, type ResolvedRedditAccountConfig } from "./schema.ts";
import tools from "./tools.ts";

const packageConfigSchema = z.object({
  reddit: RedditServiceConfigSchema.prefault({ accounts: {} }),
});

export default {
  name: packageJSON.name,
  displayName: "Reddit Integration",
  version: packageJSON.version,
  description: packageJSON.description,
  install(app) {
    app.addService(new RedditService(app));

    app.waitForService(AgentCommandService, commandService => {
      commandService.addAgentCommands(agentCommands);
    });

    app.waitForService(ChatService, chatService => chatService.addTools(tools));

    app.waitForService(ScriptingService, (scriptingService: ScriptingService) => {
      scriptingService.registerFunction("searchSubreddit", {
        type: "native",
        params: ["subreddit", "query"],
        async execute(this: ScriptingThis, subreddit: string, query: string): Promise<string> {
          const result = await this.agent.requireService(RedditService).searchSubreddit(subreddit, query);
          return JSON.stringify(result.data.children);
        },
      });

      scriptingService.registerFunction("getRedditPost", {
        type: "native",
        params: ["url"],
        async execute(this: ScriptingThis, url: string): Promise<string> {
          const result = await this.agent.requireService(RedditService).retrievePost(url);
          return JSON.stringify(result);
        },
      });

      scriptingService.registerFunction("getLatestPosts", {
        type: "native",
        params: ["subreddit"],
        async execute(this: ScriptingThis, subreddit: string): Promise<string> {
          const result = await this.agent.requireService(RedditService).getLatestPosts(subreddit);
          return JSON.stringify(result.data.children);
        },
      });
    });
  },
  async reconfigure(app, config) {
    const resolvedAccounts: Record<string, ResolvedRedditAccountConfig> = {};
    for (const [accountName, account] of Object.entries(config.reddit.accounts)) {
      const { accessToken: accessTokenRef, refreshToken: refreshTokenRef, clientSecret: clientSecretRef, ...rest } = account;
      const accessToken = resolveSecret(app, accessTokenRef);
      const refreshToken = resolveSecret(app, refreshTokenRef);
      const clientSecret = resolveSecret(app, clientSecretRef);

      if (!accessToken && !refreshToken) {
        throw new Error(`Reddit account "${accountName}" needs an accessToken or a refreshToken (with clientId and clientSecret)`);
      }
      if (refreshToken && (!rest.clientId || !clientSecret)) {
        throw new Error(`Reddit account "${accountName}" refreshToken requires clientId and clientSecret`);
      }

      const resolved: ResolvedRedditAccountConfig = { ...rest };
      if (accessToken !== undefined) resolved.accessToken = accessToken;
      if (refreshToken !== undefined) resolved.refreshToken = refreshToken;
      if (clientSecret !== undefined) resolved.clientSecret = clientSecret;
      resolvedAccounts[accountName] = resolved;
    }

    await app.requireService(RedditService).reconfigure({
      accounts: resolvedAccounts,
      publicBaseUrl: config.reddit.publicBaseUrl,
      userAgent: config.reddit.userAgent,
    });
  },
  configSchema: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
