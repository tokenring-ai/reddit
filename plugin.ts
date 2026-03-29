import {TokenRingPlugin} from "@tokenring-ai/app";
import {ChatService} from "@tokenring-ai/chat";
import {SocialMediaConfigSchema, SocialMediaService} from "../social/index.ts";
import {ScriptingService} from "@tokenring-ai/scripting";
import {ScriptingThis} from "@tokenring-ai/scripting/ScriptingService";
import {z} from "zod";
import packageJSON from './package.json' with {type: 'json'};
import RedditService from "./RedditService.ts";
import {RedditConfigSchema} from "./schema.ts";

import tools from "./tools.ts";

const packageConfigSchema = z.object({
  reddit: RedditConfigSchema.prefault({}),
  social: SocialMediaConfigSchema.optional(),
});

export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(app, config) {
    app.services.waitForItemByType(ScriptingService, (scriptingService: ScriptingService) => {
      scriptingService.registerFunction("searchSubreddit", {
          type: 'native',
          params: ['subreddit', 'query'],
          async execute(this: ScriptingThis, subreddit: string, query: string): Promise<string> {
            const result = await this.agent.requireServiceByType(RedditService).searchSubreddit(subreddit, query);
            return JSON.stringify(result.data.children);
          }
        }
      );

      scriptingService.registerFunction("getRedditPost", {
          type: 'native',
          params: ['url'],
          async execute(this: ScriptingThis, url: string): Promise<string> {
            const result = await this.agent.requireServiceByType(RedditService).retrievePost(url);
            return JSON.stringify(result);
          }
        }
      );

      scriptingService.registerFunction("getLatestPosts", {
          type: 'native',
          params: ['subreddit'],
          async execute(this: ScriptingThis, subreddit: string): Promise<string> {
            const result = await this.agent.requireServiceByType(RedditService).getLatestPosts(subreddit);
            return JSON.stringify(result.data.children);
          }
        }
      );
    });
    app.waitForService(ChatService, chatService =>
      chatService.addTools(tools)
    );

    if (config.social) {
      app.services.waitForItemByType(SocialMediaService, socialService => {
        for (const name in config.social!.providers) {
          const provider = config.social!.providers[name];
          if (provider.type === "reddit") {
            socialService.registerSocialMediaProvider(name, new RedditService(RedditConfigSchema.parse(provider)));
          }
        }
      });
    }

    app.addServices(new RedditService(config.reddit));
  },
  config: packageConfigSchema
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
