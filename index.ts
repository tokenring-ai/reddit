import {AgentCommandService, AgentTeam, TokenRingPackage} from "@tokenring-ai/agent";
import {AIService} from "@tokenring-ai/ai-client";
import {ScriptingService} from "@tokenring-ai/scripting";
import {ScriptingThis} from "@tokenring-ai/scripting/ScriptingService.ts";
import packageJSON from './package.json' with {type: 'json'};
import RedditService from "./RedditService.js";

import * as tools from "./tools.ts";

export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(agentTeam: AgentTeam) {
    agentTeam.services.waitForItemByType(ScriptingService).then((scriptingService: ScriptingService) => {
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
    agentTeam.waitForService(AIService, aiService =>
      aiService.addTools(packageJSON.name, tools)
    );
    agentTeam.addServices(new RedditService());
  },
} as TokenRingPackage;

export {default as RedditService} from "./RedditService.ts";